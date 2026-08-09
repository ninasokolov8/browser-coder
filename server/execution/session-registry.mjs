/**
 * Live interactive sessions, and the routing that makes them work behind more
 * than one replica.
 *
 * V-08: session state lives in a process-local Map, while production runs
 * `replicas: 2` behind nginx `least_conn`. The output stream is the response body
 * of the request that started the program, so it stays pinned to replica A - but
 * the follow-up `POST /api/run/interactive/:id/stdin` is load-balanced
 * independently and lands on replica B roughly half the time, where the session
 * does not exist and the answer is 410. Interactive input is therefore broken in
 * production about half the time, non-deterministically.
 *
 * The fix chosen here is in-app forwarding: the session ID carries the address of
 * the replica that owns it, and a replica asked about a session it does not own
 * proxies the command to the owner over the internal network. This is correct at
 * any replica count and needs no new infrastructure. Redis would be the eventual
 * answer, but it is a service to deploy, monitor and back up for a problem that
 * one hop solves.
 *
 * Forwarding is deliberately constrained, because a session ID is client-supplied
 * data and naive forwarding would be an SSRF primitive:
 *
 *   - only RFC1918 / loopback destinations are accepted, on the configured API
 *     port only, so the reachable set is exactly the sibling containers that the
 *     internal network already exposes;
 *   - a forwarded request carries a marker header and is never forwarded again,
 *     bounding the chain to one hop and making a forwarding loop impossible;
 *   - a malformed or non-local token is a 410, identical to an expired session,
 *     so the endpoint reveals nothing about what is reachable.
 */

import crypto from 'node:crypto';
import os from 'node:os';

import { TerminationReason } from '../domain/termination.mjs';
import { log } from '../logging.mjs';

/** Header marking an already-forwarded command. One hop only. */
export const FORWARDED_HEADER = 'x-browser-coder-forwarded';

/** Pick this instance's address on a private network, for the session token. */
function detectInstanceAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (isPrivateAddress(entry.address)) return entry.address;
    }
  }
  return '127.0.0.1';
}

export function isPrivateAddress(address) {
  if (!address) return false;
  const v4 = address.replace(/^::ffff:/, '');
  if (v4 === '127.0.0.1' || address === '::1') return true;
  return (
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4)
  );
}

export class SessionRegistry {
  /**
   * @param {object} options
   * @param {object} options.config CONFIG
   */
  constructor({ config }) {
    this.config = config;
    this.sessions = new Map();
    this.perIpCounts = new Map();

    this.instanceAddress = detectInstanceAddress();
    this.instancePort = config.port;
    // Base64url so the token is URL-safe inside a path segment.
    this.instanceToken = Buffer.from(`${this.instanceAddress}:${this.instancePort}`).toString(
      'base64url',
    );
  }

  get size() {
    return this.sessions.size;
  }

  /** Directories of live sessions, so the reaper does not delete them. */
  liveDirectories() {
    const dirs = new Set();
    for (const session of this.sessions.values()) {
      if (session.jobDir) dirs.add(session.jobDir);
    }
    return dirs;
  }

  /**
   * Check the admission limits.
   *
   * Separate from `register` so the caller can refuse before doing any
   * preparation work, and so the count is incremented at registration rather
   * than after the process has already started (V-27).
   */
  checkCapacity(ip) {
    if (this.sessions.size >= this.config.execution.maxInteractiveSessions) {
      return {
        ok: false,
        status: 503,
        error: 'Too many interactive sessions - try again shortly',
        retryAfter: 5,
      };
    }
    const perIp = this.perIpCounts.get(ip) || 0;
    if (perIp >= this.config.execution.maxInteractiveSessionsPerIp) {
      return {
        ok: false,
        status: 429,
        error: 'Too many concurrent interactive runs from your connection',
      };
    }
    return { ok: true };
  }

  /**
   * Register a live session.
   *
   * The ID is `<instanceToken>.<random>`. The random half is 128 bits, so the ID
   * is unguessable and functions as a bearer capability for the session; the
   * instance half is routing metadata only and grants nothing.
   */
  register(session) {
    const id = `${this.instanceToken}.${crypto.randomBytes(16).toString('hex')}`;
    this.sessions.set(id, { ...session, id, createdAt: Date.now() });
    this.perIpCounts.set(session.ip, (this.perIpCounts.get(session.ip) || 0) + 1);
    return id;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  remove(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);

    const remaining = (this.perIpCounts.get(session.ip) || 1) - 1;
    if (remaining <= 0) this.perIpCounts.delete(session.ip);
    else this.perIpCounts.set(session.ip, remaining);
  }

  /**
   * Where a session ID says its owner is, when that is not us.
   *
   * @returns {{host: string, port: number} | null} null when we own it, when the
   *   token is malformed, or when the destination is not an acceptable internal
   *   address - all three are indistinguishable to the caller by design.
   */
  ownerOf(id) {
    const separator = id.indexOf('.');
    if (separator <= 0) return null;

    const token = id.slice(0, separator);
    if (token === this.instanceToken) return null;

    let decoded;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    const match = /^([0-9.]{7,15}):(\d{2,5})$/.exec(decoded);
    if (!match) return null;

    const [, host, portText] = match;
    const port = Number.parseInt(portText, 10);

    // Only siblings on the internal network, only on our own port. Anything else
    // would make this endpoint a request forwarder for arbitrary destinations.
    if (!isPrivateAddress(host) || port !== this.instancePort) {
      log('warn', 'session_forward_rejected', { reason: 'destination_not_allowed' });
      return null;
    }

    return { host, port };
  }

  /**
   * Deliver one line of input to a session.
   *
   * Newlines are stripped so one submit is exactly one line, and the payload is
   * bounded before it is written.
   */
  writeStdin(id, data) {
    const session = this.get(id);
    if (!session || session.finished) return false;

    const line = String(data ?? '')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 10000);

    const accepted = session.handle.writeStdin(`${line}\n`);
    session.onActivity?.();
    return accepted;
  }

  /** Stop a session's program. */
  stop(id, reason = TerminationReason.CANCELLED) {
    const session = this.get(id);
    if (!session || session.finished) return false;
    session.handle.stop(reason);
    return true;
  }

  /** Signal EOF without terminating, so `input()` past the end raises normally. */
  closeStdin(id) {
    const session = this.get(id);
    if (!session || session.finished) return false;
    session.handle.closeStdin();
    return true;
  }

  /** Terminate everything. Used on drain. */
  stopAll(reason = TerminationReason.CANCELLED) {
    let stopped = 0;
    for (const session of this.sessions.values()) {
      if (session.finished) continue;
      try {
        session.handle.stop(reason);
        stopped++;
      } catch {
        /* already gone */
      }
    }
    return stopped;
  }
}
