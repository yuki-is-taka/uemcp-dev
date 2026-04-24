// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Thin HTTP client the launcher uses to invoke the singleton daemon. Handles
// transient-crash recovery: if the daemon has died between calls, a network-
// level error (ECONNREFUSED / ECONNRESET / socket hang up) triggers one retry
// with `ensureDaemonAlive()` in between. HTTP-level errors (4xx/5xx) are NOT
// retried — those are legitimate application failures the caller should see.

import http from 'node:http';

import { ensureDaemonAlive } from './daemonLifecycle.js';
import { DAEMON_HOST, DAEMON_PORT } from './protocol.js';

export async function daemonGet<T = unknown>(path: string): Promise<T> {
  return (await requestWithRetry('GET', path)) as T;
}

export async function daemonPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return (await requestWithRetry('POST', path, JSON.stringify(body))) as T;
}

/**
 * Send the request; on a network-level error, revive the daemon once and
 * try again. Capped at 2 total attempts to avoid thrashing against a daemon
 * that fails to start.
 */
async function requestWithRetry(
  method: string,
  path: string,
  body?: string,
): Promise<unknown> {
  try {
    return await request(method, path, body);
  } catch (err) {
    if (!isRetryableNetworkError(err)) throw err;
    // Daemon likely crashed or never came up. Respawn, then try once more.
    await ensureDaemonAlive();
    return request(method, path, body);
  }
}

/**
 * Heuristic: retry only the errors that indicate the daemon process is
 * unreachable at the socket layer. HTTP 4xx/5xx are parsed by `request()` and
 * thrown as `Error: daemon returned N: <body>` — those are NOT retryable,
 * they reflect the caller's input or the daemon's internal state.
 */
function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  if (code && ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(code)) {
    return true;
  }
  // Some node versions surface connection loss mid-response as a plain Error
  // with this message and no .code — include as a fallback.
  return /socket hang up|connect ECONNREFUSED/i.test(err.message);
}

function request(method: string, path: string, body?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = body
      ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        }
      : {};

    const req = http.request(
      {
        host: DAEMON_HOST,
        port: DAEMON_PORT,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            if (!text) {
              resolve(undefined);
              return;
            }
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve(text);
            }
          } else {
            reject(new Error(`daemon returned ${status}: ${text}`));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
