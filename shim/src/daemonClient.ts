// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Thin HTTP client the launcher uses to invoke the singleton daemon.

import http from 'node:http';

import { DAEMON_HOST, DAEMON_PORT } from './protocol.js';

export async function daemonGet<T = unknown>(path: string): Promise<T> {
  return (await request('GET', path)) as T;
}

export async function daemonPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return (await request('POST', path, JSON.stringify(body))) as T;
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
