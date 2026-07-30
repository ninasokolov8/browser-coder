/**
 * A Job is one execution's private, disposable directory.
 *
 * Replaces the shared-temp-root model, which had three distinct defects:
 *
 *   V-23  Single-file Java wrote `<temp>/<ClassName>.java` and `.class` into the
 *         shared root, so two students running `Main.java` at the same moment
 *         overwrote each other's source and each other's bytecode - and the
 *         `finally` block then deleted the other run's artifacts.
 *   V-24  Single-file JS/TS ran with `--allow-fs-read=<shared temp root>`, so any
 *         program could read every other concurrent job's source.
 *   V-25  Cleanup used `unlinkSync` on directory entries under one outer `try`.
 *         `_csharp_template` is always present and always older than the
 *         threshold, so it threw EISDIR/EPERM and aborted the sweep before
 *         reaching any real garbage. Nothing was ever reaped.
 *
 * Every job now gets its own directory. Nothing is shared, so there is nothing
 * to collide over, and cleanup is a single recursive remove that cannot be
 * confused by a directory.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { log } from '../logging.mjs';

/** Directory name prefix, also used by the reaper to recognise its own garbage. */
const JOB_PREFIX = 'job-';

export class Job {
  /**
   * @param {string} root parent directory for all jobs
   * @param {string} [kind] short label for diagnosis, e.g. 'run' or 'session'
   */
  constructor(root, kind = 'run') {
    this.id = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
    this.kind = kind;
    this.dir = path.join(root, `${JOB_PREFIX}${kind}-${this.id}`);
    this.disposed = false;

    // mode 0o700: only the service user can traverse it. Combined with one
    // directory per job this is what makes cross-job reads impossible rather
    // than merely unlikely.
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  /**
   * Absolute path for a validated relative workspace path.
   *
   * Callers must pass a path that has already been through
   * normalizeWorkspacePath. The containment check here is a backstop against a
   * future caller forgetting, not the primary defence - it must never be the
   * only thing standing between a request and the filesystem.
   */
  absolute(relativePath) {
    const resolved = path.resolve(this.dir, relativePath);
    const root = path.resolve(this.dir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Path escapes the job directory: ${relativePath}`);
    }
    return resolved;
  }

  /** Write one file, creating parent directories as needed. */
  writeFile(relativePath, content) {
    const target = this.absolute(relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    // Exact bytes: the content is written as UTF-8 with no normalization, no
    // trailing-newline insertion and no EOL rewriting. Whitespace is program
    // text in Python and significant in every language's string literals.
    fs.writeFileSync(target, content, { encoding: 'utf8', mode: 0o600 });
    return target;
  }

  /** Write a whole validated file set. */
  writeFiles(files) {
    for (const file of files) this.writeFile(file.name, file.content);
  }

  readFile(relativePath) {
    return fs.readFileSync(this.absolute(relativePath), 'utf8');
  }

  exists(relativePath) {
    try {
      return fs.existsSync(this.absolute(relativePath));
    } catch {
      return false;
    }
  }

  /** Every directory in the job, deepest last. Used for import search paths. */
  directories() {
    const found = [];
    const walk = dir => {
      found.push(dir);
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== '__pycache__') {
          walk(path.join(dir, entry.name));
        }
      }
    };
    walk(this.dir);
    return found;
  }

  /** Every file matching a predicate, as absolute paths. */
  findFiles(predicate) {
    const found = [];
    const walk = dir => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__pycache__') walk(full);
        } else if (entry.isFile() && predicate(entry.name, full)) {
          found.push(full);
        }
      }
    };
    walk(this.dir);
    return found;
  }

  /**
   * Remove the whole job directory.
   *
   * Idempotent, and `force: true` so a missing directory is not an error - a
   * disposal path that can throw is a disposal path that leaks.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      fs.rmSync(this.dir, { recursive: true, force: true });
    } catch (error) {
      log('warn', 'job_dispose_failed', { jobId: this.id, error: error.message });
    }
  }
}

/**
 * Remove job directories left behind by a crash or a hard kill.
 *
 * Unlike the implementation this replaces:
 *   - it only ever touches directories it can identify as job directories, so it
 *     cannot delete the C# template or anything else the service owns;
 *   - each entry is removed inside its own try, so one failure cannot abort the
 *     sweep - the previous single outer try is why nothing was ever reaped;
 *   - it uses a recursive remove, so encountering a directory is normal rather
 *     than an EISDIR that kills the pass.
 *
 * @param {string} root
 * @param {number} maxAgeMs
 * @param {Set<string>} [activeDirs] directories belonging to live sessions, which
 *   may legitimately be older than maxAgeMs while a student is still typing.
 */
export function reapAbandonedJobs(root, maxAgeMs, activeDirs = new Set()) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { scanned: 0, removed: 0, failed: 0 };
  }

  const cutoff = Date.now() - maxAgeMs;
  let scanned = 0;
  let removed = 0;
  let failed = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(JOB_PREFIX)) continue;

    const full = path.join(root, entry.name);
    scanned++;

    if (activeDirs.has(full)) continue;

    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs >= cutoff) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
    } catch (error) {
      // Deliberately per-entry: one undeletable directory must not stop the rest.
      failed++;
      log('warn', 'job_reap_failed', { dir: entry.name, error: error.message });
    }
  }

  if (removed > 0 || failed > 0) {
    log('info', 'job_reap', { scanned, removed, failed });
  }
  return { scanned, removed, failed };
}
