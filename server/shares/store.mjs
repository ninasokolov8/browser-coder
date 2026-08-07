/**
 * Shared project snapshots.
 *
 * ## What this is, and what it very deliberately is not
 *
 * A student stuck on something publishes their whole project and sends a link. Whoever
 * opens it - a teacher, a classmate, themselves on another machine - gets exactly the
 * files they had, read-only, in the IDE.
 *
 * It is NOT live collaboration. There is no shared cursor, no presence, no
 * simultaneous editing, and opening a link twice does not connect the two people. That
 * is a deliberate refusal rather than a first step, and section 52 of the blueprint
 * gives the reasoning: real co-editing needs a CRDT or OT, a stateful hub every replica
 * can reach, and a conflict model - none of which this architecture has, all of which
 * would be load-bearing the moment one student trusted them with their homework.
 *
 * What it IS covers the case the blueprint actually described - "teacher-can-see-my-
 * screen" - and covers it for a teacher who is asleep when the message is sent, which
 * a live session does not.
 *
 * ## Why it is not the preview store
 *
 * A preview publishes a *website* for a browser to render: HTML, sandboxed, served
 * under a CSP. A share publishes a *project* for the IDE to open: any language, no
 * execution, and the payload is the same file list a run already speaks. The two have
 * different validation, different lifetimes and different threat models, and folding
 * them together would mean one route deciding which it was by inspecting the files.
 *
 * ## A snapshot is immutable
 *
 * Editing a shared copy never changes the original, and re-sharing produces a new id.
 * A link therefore always shows what was sent - which is the entire value of sending
 * one to somebody who will look at it tomorrow.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** `sha`-free, URL-safe, 128 bits. Same shape and same reasoning as a preview id. */
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function parseShareId(value) {
  if (typeof value !== 'string') return null;
  return SHARE_ID_PATTERN.test(value) ? value : null;
}

export class ShareStore {
  #root;
  #ttlMs;
  #maxBytes;
  #maxFiles;
  #sweepTimer = null;
  #ready = false;
  #log;

  constructor({ directory, ttlMs, maxBytes, maxFiles, sweepIntervalMs, log = () => {} }) {
    this.#root = directory ? path.resolve(directory) : null;
    this.#ttlMs = ttlMs;
    this.#maxBytes = maxBytes;
    this.#maxFiles = maxFiles;
    this.sweepIntervalMs = sweepIntervalMs;
    this.#log = log;
  }

  get isReady() {
    return this.#ready;
  }

  get root() {
    return this.#root;
  }

  start() {
    if (!this.#root) return;
    try {
      fs.mkdirSync(this.#root, { recursive: true, mode: 0o700 });
      const probe = path.join(this.#root, `.writable-${process.pid}`);
      fs.writeFileSync(probe, '');
      fs.unlinkSync(probe);
      this.#ready = true;
    } catch (error) {
      this.#log('warn', 'share_store_unavailable', { error: error.message });
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

  #pathOf(id) {
    const share = parseShareId(id);
    return share && this.#root ? path.join(this.#root, `${share}.json`) : null;
  }

  /**
   * Validate a project and store it. Returns its id.
   *
   * Throws with a message meant for a student, because these are the limits they can
   * actually hit - a project with too many files, or one enormous one.
   */
  publish(payload) {
    if (!this.#ready) throw new Error('Sharing is not available on this server.');

    const files = Array.isArray(payload?.files) ? payload.files : null;
    if (!files || files.length === 0) throw new Error('There is nothing to share.');
    if (files.length > this.#maxFiles) {
      throw new Error(`A shared project may hold at most ${this.#maxFiles} files.`);
    }

    const clean = [];
    let total = 0;

    for (const file of files) {
      const filePath = typeof file?.path === 'string' ? file.path : null;
      const content = typeof file?.content === 'string' ? file.content : null;
      if (!filePath || content === null) continue;

      /*
       * The same containment rule a run payload gets.
       *
       * A share is read back by the IDE and written into somebody else's workspace, so
       * a path that climbs out of the project would put a file somewhere they did not
       * choose - and the person opening it has even less reason to expect that than
       * the person who published it.
       */
      const normalised = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!normalised || normalised.split('/').some(part => part === '..' || part === '')) {
        continue;
      }

      total += content.length;
      if (total > this.#maxBytes) throw new Error('This project is too large to share.');

      clean.push({
        path: normalised,
        content,
        language: typeof file.language === 'string' ? file.language : undefined,
        version: typeof file.version === 'string' ? file.version : undefined,
      });
    }

    if (clean.length === 0) throw new Error('There is nothing to share.');

    const document = JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      language: typeof payload.language === 'string' ? payload.language : undefined,
      entryPoint: typeof payload.entryPoint === 'string' ? payload.entryPoint : undefined,
      files: clean,
    });

    // Retried, because two publishes in the same millisecond on two replicas could in
    // principle collide - and `wx` makes the collision a failure rather than an
    // overwrite of somebody else's project.
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = crypto.randomBytes(16).toString('base64url');
      const target = this.#pathOf(id);
      try {
        fs.writeFileSync(target, document, { flag: 'wx', mode: 0o600 });
        return id;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }

    throw new Error('Could not create a share link. Please try again.');
  }

  /** The stored project, or null. */
  read(id) {
    const target = this.#pathOf(id);
    if (!target || !this.#ready) return null;
    try {
      return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Delete what has expired. A share is a message, not an archive. */
  sweep() {
    if (!this.#ready) return { removed: 0 };

    let removed = 0;
    const cutoff = Date.now() - this.#ttlMs;

    let listing;
    try {
      listing = fs.readdirSync(this.#root);
    } catch {
      return { removed };
    }

    for (const name of listing) {
      if (!name.endsWith('.json')) continue;
      if (!parseShareId(name.slice(0, -5))) continue;

      const full = path.join(this.#root, name);
      try {
        // mtime, not atime: a share that many people OPEN has not become more
        // permanent, and its author expected it to expire when they published it.
        if (fs.statSync(full).mtimeMs < cutoff) {
          fs.unlinkSync(full);
          removed += 1;
        }
      } catch {
        // Gone already.
      }
    }

    if (removed > 0) this.#log('info', 'shares_swept', { removed });
    return { removed };
  }
}
