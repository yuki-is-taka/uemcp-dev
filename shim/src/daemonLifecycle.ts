// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Daemon process lifecycle helpers shared by the launcher (for first-boot
// spawning) and daemonClient (for retry-on-crash recovery). Also owns the
// log-file plumbing so daemon stderr survives a crash for post-mortem reading.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  DAEMON_HEALTH_TIMEOUT_MS,
  DAEMON_HOST,
  DAEMON_PORT,
  DAEMON_START_TIMEOUT_MS,
  LOG_FILE_MAX_BYTES,
  LOG_FILE_RETAIN_COUNT,
} from './protocol.js';

/** Location of the rotating daemon log file. `~/.uemcp/logs/daemon.log`. */
export function daemonLogPath(): string {
  return path.join(os.homedir(), '.uemcp', 'logs', 'daemon.log');
}

/**
 * Open the daemon log for append, rotating once up-front if it has exceeded
 * the size cap. Returns an OS-level fd safe to pass to `spawn`'s stdio so the
 * child inherits it; the caller may close its own handle after the spawn.
 */
export function openDaemonLogForSpawn(): number {
  const logPath = daemonLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  rotateIfNeeded(logPath, LOG_FILE_MAX_BYTES, LOG_FILE_RETAIN_COUNT);
  return fs.openSync(logPath, 'a');
}

/**
 * Size-threshold rotation. Called once at daemon spawn time so we don't pay
 * the cost on every write. If the current log is over `maxBytes`, shift
 * `.1 → .2 → ... → .N`, drop the oldest, and let the fresh log start empty.
 */
function rotateIfNeeded(logPath: string, maxBytes: number, retain: number): void {
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(logPath);
  } catch {
    return;
  }
  if (stat.size < maxBytes) return;

  // Drop the oldest.
  const oldest = `${logPath}.${retain}`;
  try {
    fs.rmSync(oldest, { force: true });
  } catch {
    // best-effort
  }
  // Shift N-1 → N, N-2 → N-1, ..., 1 → 2.
  for (let i = retain - 1; i >= 1; i--) {
    const src = `${logPath}.${i}`;
    const dst = `${logPath}.${i + 1}`;
    try {
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    } catch {
      // best-effort
    }
  }
  // Current → .1
  try {
    fs.renameSync(logPath, `${logPath}.1`);
  } catch {
    // best-effort
  }
}

/** True if the daemon's `/health` endpoint responds 200 within the timeout. */
export function isDaemonAlive(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.request(
      {
        host: DAEMON_HOST,
        port: DAEMON_PORT,
        path: '/health',
        method: 'GET',
        timeout: DAEMON_HEALTH_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** Fire-and-forget detached spawn of the daemon, with stderr routed to the log file. */
export function spawnDaemonDetached(): void {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('Cannot spawn daemon: process.argv[1] is unset');
  }
  const logFd = openDaemonLogForSpawn();
  try {
    const child = spawn(process.execPath, [entry, 'daemon'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
    child.unref();
  } finally {
    // Parent no longer needs the fd; the child has inherited it.
    try {
      fs.closeSync(logFd);
    } catch {
      // ignore
    }
  }
}

/**
 * Ensure a daemon is reachable on the configured host:port. If not, spawn one
 * detached and poll `/health` until it comes up or the timeout elapses. Idempotent.
 */
export async function ensureDaemonAlive(): Promise<void> {
  if (await isDaemonAlive()) return;

  spawnDaemonDetached();

  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(200);
    if (await isDaemonAlive()) return;
  }
  throw new Error(
    `uemcp daemon did not become reachable on ${DAEMON_HOST}:${DAEMON_PORT} within ${DAEMON_START_TIMEOUT_MS}ms`,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
