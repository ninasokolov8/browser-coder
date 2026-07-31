/**
 * Immutable preview storage.
 *
 * A class rather than the module-level functions plus loose `let previewStorageReady`
 * this replaces. The old shape ran three side effects at import time - create the
 * directory, start a cleanup interval, kick off a first sweep - which meant merely
 * importing the server touched the filesystem and armed a timer. That is why the
 * contract tests had to spawn a whole process to test anything nearby, and why a
 * unit test could not construct the store against a temporary directory.
 *
 * Publishing is atomic by construction: files are written into a private temporary
 * directory and then `rename`d into place, so a reader either sees a complete
 * project or nothing. A partially-written preview is never addressable.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  PREVIEW_ID_PATTERN,
  PREVIEW_MANIFEST_NAME,
  normalizePreviewProjectPath,
  safePreviewAssetPath,
} from './project.mjs';

/** Abandoned temporary directories older than this are swept. */
const ABANDONED_TEMPORARY_MS = 60 * 60 * 1000;

export class PreviewStore {
  #storageDir;
  #limits;
  #log;
  #ready = false;
  #cleanupTimer = null;

  /**
   * @param {object} options
   * @param {string} options.storageDir
   * @param {object} options.limits  CONFIG.preview
   * @param {Function} options.log
   */
  constructor({ storageDir, limits, log }) {
    this.#storageDir = storageDir;
    this.#limits = limits;
    this.#log = log;
  }

  get isReady() {
    return this.#ready;
  }

  get limits() {
    return this.#limits;
  }

  /**
   * Prepare storage and start the cleanup sweep.
   *
   * Returns whether storage is usable instead of throwing: a server that cannot
   * write previews must still serve code execution, and the routes answer 503 for
   * previews alone. Called explicitly by the composition root, so importing this
   * module has no side effects.
   */
  start() {
    try {
      this.#ensureStorageDir();
      this.#ready = true;
    } catch (error) {
      this.#log('error', 'preview_storage_startup_failed', {
        path: this.#storageDir,
        error: error instanceof Error ? error.message : String(error),
      });
      this.#ready = false;
      return false;
    }

    this.#cleanupTimer = setInterval(() => {
      if (this.#ready) void this.cleanupExpired();
    }, this.#limits.cleanupIntervalMs);
    // Unref'd so a pending sweep cannot hold the process open during shutdown.
    this.#cleanupTimer.unref?.();

    void this.cleanupExpired();
    return true;
  }

  stop() {
    if (this.#cleanupTimer) clearInterval(this.#cleanupTimer);
    this.#cleanupTimer = null;
  }

  // ===== paths =====

  directoryPath(previewId) {
    if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
    return path.join(this.#storageDir, previewId);
  }

  manifestPath(previewId) {
    const directory = this.directoryPath(previewId);
    return directory ? path.join(directory, PREVIEW_MANIFEST_NAME) : null;
  }

  legacyFilePath(previewId) {
    if (!PREVIEW_ID_PATTERN.test(previewId)) return null;
    return path.join(this.#storageDir, `${previewId}.html`);
  }

  assetPath(previewId, requestedPath) {
    return safePreviewAssetPath(this.#storageDir, previewId, requestedPath, this.#limits);
  }

  // ===== publish =====

  /**
   * Write a project and return its id.
   *
   * `flag: 'wx'` on every write means an existing file is an error rather than
   * being overwritten - inside a fresh temporary directory that can only happen if
   * two supplied paths collide after normalization, which is a bug worth surfacing.
   */
  async publish(files, entryPath) {
    this.#ensureStorageDir();

    for (let attempt = 0; attempt < 5; attempt++) {
      const previewId = this.#createId();
      const finalDirectory = this.directoryPath(previewId);
      const temporaryDirectory = path.join(
        this.#storageDir,
        `.${previewId}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
      );

      try {
        await fs.promises.mkdir(temporaryDirectory, { mode: 0o700 });

        for (const file of files) {
          const destination = path.resolve(temporaryDirectory, file.path);
          const resolvedTemporary = path.resolve(temporaryDirectory);
          // Belt and braces: the paths were validated before reaching here, but a
          // write that escapes the temporary directory would escape into shared
          // storage, so it is re-checked at the point of the actual write.
          if (!destination.startsWith(`${resolvedTemporary}${path.sep}`)) {
            throw new Error(`Unsafe preview file path: ${file.path}`);
          }

          await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
          await fs.promises.writeFile(destination, file.content, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
          });
        }

        const manifest = {
          version: 2,
          entryPath,
          createdAt: Date.now(),
          fileCount: files.length,
        };
        await fs.promises.writeFile(
          path.join(temporaryDirectory, PREVIEW_MANIFEST_NAME),
          JSON.stringify(manifest),
          { encoding: 'utf8', flag: 'wx', mode: 0o600 },
        );

        // The atomic step. Until this succeeds the preview id addresses nothing.
        await fs.promises.rename(temporaryDirectory, finalDirectory);
        return previewId;
      } catch (error) {
        await fs.promises
          .rm(temporaryDirectory, { recursive: true, force: true })
          .catch(() => {});

        // A colliding id is worth retrying; anything else is not.
        if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY') continue;
        throw error;
      }
    }

    throw new Error('Could not allocate a unique preview ID');
  }

  // ===== read =====

  async readManifest(previewId) {
    const manifestPath = this.manifestPath(previewId);
    if (!manifestPath) return null;

    try {
      const raw = await fs.promises.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const entryPath = normalizePreviewProjectPath(manifest?.entryPath, this.#limits);
      const createdAt = Number(manifest?.createdAt);

      // A manifest that fails these checks is treated as absent rather than
      // trusted-with-defaults: it addresses a directory we cannot describe.
      if (!entryPath || !Number.isFinite(createdAt)) return null;

      return { entryPath, createdAt, fileCount: Number(manifest?.fileCount) || 0 };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  isExpired(createdAt) {
    return Date.now() - createdAt > this.#limits.ttlMs;
  }

  async remove(previewId) {
    const directory = this.directoryPath(previewId);
    if (!directory) return;
    await fs.promises.rm(directory, { recursive: true, force: true });
  }

  // ===== maintenance =====

  async cleanupExpired() {
    this.#ensureStorageDir();
    const expiresBefore = Date.now() - this.#limits.ttlMs;
    const abandonedBefore = Date.now() - ABANDONED_TEMPORARY_MS;

    let entries;
    try {
      entries = await fs.promises.readdir(this.#storageDir, { withFileTypes: true });
    } catch (error) {
      this.#log('warn', 'Preview cleanup could not read storage', { error: error.message });
      return;
    }

    // allSettled, so one unreadable entry cannot abort the sweep for the rest.
    await Promise.allSettled(entries.map(async entry => {
      const itemPath = path.join(this.#storageDir, entry.name);

      if (entry.isFile() && /^[A-Za-z0-9_-]{22}\.html$/.test(entry.name)) {
        const stat = await fs.promises.stat(itemPath);
        if (stat.mtimeMs < expiresBefore) await fs.promises.unlink(itemPath);
        return;
      }

      if (entry.isDirectory() && PREVIEW_ID_PATTERN.test(entry.name)) {
        const manifest = await this.readManifest(entry.name).catch(() => null);
        const createdAt = manifest?.createdAt || (await fs.promises.stat(itemPath)).mtimeMs;
        if (createdAt < expiresBefore) {
          await fs.promises.rm(itemPath, { recursive: true, force: true });
        }
        return;
      }

      // A temporary directory left behind by a crashed publish.
      if (entry.isDirectory() && /^\.[A-Za-z0-9_-]{22}\..+\.tmp$/.test(entry.name)) {
        const stat = await fs.promises.stat(itemPath);
        if (stat.mtimeMs < abandonedBefore) {
          await fs.promises.rm(itemPath, { recursive: true, force: true });
        }
      }
    }));
  }

  // ===== internals =====

  #createId() {
    // 128 random bits as 22 URL-safe characters.
    return crypto.randomBytes(16).toString('base64url');
  }

  #ensureStorageDir() {
    try {
      fs.mkdirSync(this.#storageDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      this.#log('error', 'preview_storage_unavailable', {
        path: this.#storageDir,
        error: error.message,
      });
      throw new Error(`Preview storage is not writable: ${this.#storageDir}`);
    }
  }
}
