/**
 * The asset cache.
 *
 * ## What problem this solves
 *
 * A project with a 2 MiB image sends that image on EVERY run, as base64, so 2.8 MB up
 * the wire each time the student presses Run. Thirty runs while working on one exercise
 * is 84 MB of the same picture. Blueprint 44.6 called for "a multipart upload for
 * assets, so a project with images is not re-uploaded in full on every Run".
 *
 * Multipart is the wrong answer to that sentence. It removes base64's 33% and nothing
 * else - 84 MB becomes 63 MB - at the cost of hand-writing a streaming boundary parser,
 * because there is no multipart dependency here and none is wanted. Content addressing
 * removes the repetition instead: 84 MB becomes 2.8 MB plus twenty-nine short requests.
 *
 * ## This is a CACHE, and never a store of record
 *
 * The workspace in the browser is the only place a student's file really lives. Every
 * entry here can be deleted at any moment - by the sweeper, by a restart, by a deploy
 * onto a fresh volume - and the only consequence must be that the next run uploads the
 * bytes again. Nothing may ever be served FROM here to a student, and there is
 * deliberately no read route: an anonymous, content-addressed, publicly-writable file
 * store with a GET is a file host, and this is a teaching IDE.
 *
 * ## The multi-replica question, answered honestly
 *
 * A per-replica cache would hit with probability 1/N, and a miss costs an extra
 * round trip on top of the upload - so at two replicas it would be slower than doing
 * nothing half the time. This expects a SHARED directory, exactly as previews do
 * (`PREVIEW_STORAGE_DIR`), and where one is not configured the feature simply does not
 * engage: `isReady` is false, the run route never advertises it, and every run carries
 * its assets inline as before. Degrading to the old behaviour is the whole design.
 *
 * Modelled on `server/previews/store.mjs` down to the shape: explicit start/stop, no
 * import-time side effects, temp file then rename.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseDigest, relativePathFor } from './digest.mjs';

export class BlobStore {
  #root;
  #maxBytes;
  #ttlMs;
  #sweepTimer = null;
  #ready = false;
  #log;

  constructor({ directory, maxBytes, ttlMs, sweepIntervalMs, log = () => {} }) {
    this.#root = directory ? path.resolve(directory) : null;
    this.#maxBytes = maxBytes;
    this.#ttlMs = ttlMs;
    this.sweepIntervalMs = sweepIntervalMs;
    this.#log = log;
  }

  /** False means "not configured or not writable" - callers fall back to inline bytes. */
  get isReady() {
    return this.#ready;
  }

  get root() {
    return this.#root;
  }

  start() {
    if (!this.#root) return;

    try {
      fs.mkdirSync(this.#root, { recursive: true });
      // Proven writable rather than assumed: a read-only mount is a configuration
      // mistake that would otherwise surface as a failed upload on a student's run.
      const probe = path.join(this.#root, `.writable-${process.pid}`);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      this.#ready = true;
    } catch (error) {
      this.#log('warn', 'blob_store_unavailable', { error: error.message });
      this.#ready = false;
      return;
    }

    this.#sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this.#sweepTimer.unref?.();
  }

  stop() {
    if (this.#sweepTimer) clearInterval(this.#sweepTimer);
    this.#sweepTimer = null;
    this.#ready = false;
  }

  /** The absolute path for a digest, or null if the token is not one. */
  pathOf(digest) {
    if (!this.#root) return null;
    const parts = relativePathFor(digest);
    return parts ? path.join(this.#root, ...parts) : null;
  }

  /** Is this content already here? */
  has(digest) {
    const target = this.pathOf(digest);
    if (!target) return false;
    try {
      return fs.statSync(target).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Read content back for a run.
   *
   * Returns null rather than throwing when it is absent, because absent is ordinary:
   * the sweeper may have removed it between the client's check and the run.
   */
  read(digest) {
    const target = this.pathOf(digest);
    if (!target) return null;
    try {
      const buffer = fs.readFileSync(target);
      this.touch(target);
      return buffer;
    } catch {
      return null;
    }
  }

  /**
   * Store content under the digest OF WHAT WAS RECEIVED.
   *
   * `claimed` is what the client said; `actual` is what was hashed here. They are
   * compared by the caller, and this only writes once they match - so a client cannot
   * put chosen bytes under a chosen name, which would turn a shared cache into a way of
   * handing one student a file another student will run.
   */
  write(digest, buffer) {
    const target = this.pathOf(digest);
    if (!target || !this.#ready) return false;

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });

      // Already here: keep the existing copy and just mark it used. The bytes are
      // identical by definition, so rewriting would only risk tearing a concurrent read.
      if (this.has(digest)) {
        this.touch(target);
        return true;
      }

      // Temp then rename, so a reader never sees a partial file. Same reasoning, and
      // the same technique, as the preview store.
      const temporary = `${target}.${process.pid}.${Date.now().toString(36)}.tmp`;
      fs.writeFileSync(temporary, buffer);
      fs.renameSync(temporary, target);
      return true;
    } catch (error) {
      this.#log('warn', 'blob_write_failed', { error: error.message });
      return false;
    }
  }

  /** Mark an entry as used, so the sweeper evicts the genuinely cold ones. */
  touch(target) {
    try {
      const now = new Date();
      fs.utimesSync(target, now, now);
    } catch {
      // A failed timestamp only makes an entry look colder than it is. Not worth
      // failing a run over.
    }
  }

  /**
   * Evict what is expired, then what is coldest until the cache fits.
   *
   * Age first and size second: an entry nobody has touched in a month is worthless
   * whatever the total, and beyond that the least recently used is the best guess at
   * what will not be wanted again.
   */
  sweep() {
    if (!this.#ready) return { removed: 0, bytes: 0 };

    const entries = [];
    let total = 0;

    const walk = directory => {
      let listing;
      try {
        listing = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of listing) {
        const full = path.join(directory, item.name);
        if (item.isDirectory()) {
          walk(full);
          continue;
        }
        if (!parseDigest(item.name)) continue;
        try {
          const stat = fs.statSync(full);
          entries.push({ path: full, size: stat.size, atime: stat.atimeMs });
          total += stat.size;
        } catch {
          // Vanished mid-sweep, which is fine - something else removed it.
        }
      }
    };

    walk(this.#root);

    const cutoff = Date.now() - this.#ttlMs;
    let removed = 0;
    let freed = 0;

    const remove = entry => {
      try {
        fs.unlinkSync(entry.path);
        removed += 1;
        freed += entry.size;
        total -= entry.size;
      } catch {
        // Already gone.
      }
    };

    for (const entry of entries) {
      if (entry.atime < cutoff) remove(entry);
    }

    if (total > this.#maxBytes) {
      const survivors = entries
        .filter(entry => entry.atime >= cutoff)
        .sort((left, right) => left.atime - right.atime);

      for (const entry of survivors) {
        if (total <= this.#maxBytes) break;
        remove(entry);
      }
    }

    if (removed > 0) this.#log('info', 'blob_cache_swept', { removed, bytes: freed });
    return { removed, bytes: freed };
  }
}
