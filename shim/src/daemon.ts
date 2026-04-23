// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Singleton HTTP daemon. Holds the UE connection pool, exposes a minimal
// internal HTTP API that launchers (one per Claude session) relay into.
// Self-exits after IDLE_TIMEOUT_MS with no requests.

import http from 'node:http';

import {
  DAEMON_HOST,
  DAEMON_PORT,
  IDLE_TIMEOUT_MS,
  SHIM_VERSION,
} from './protocol.js';
import { UEPool } from './uePool.js';

export async function runDaemon(): Promise<void> {
  const pool = new UEPool();
  try {
    await pool.start();
  } catch (err) {
    process.stderr.write(
      `uemcp-daemon: failed to start UE pool: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  let lastActivity = Date.now();

  const server = http.createServer((req, res) => {
    lastActivity = Date.now();
    void handleRequest(req, res, pool).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const body = JSON.stringify({ error: message });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(body);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Another daemon already owns the port; exit quietly so the spawning
        // launcher's /health poll still succeeds against that other daemon.
        process.stderr.write(
          `uemcp-daemon: port ${DAEMON_PORT} already bound, deferring to existing daemon\n`,
        );
        process.exit(0);
      } else {
        reject(err);
      }
    });
    server.listen(DAEMON_PORT, DAEMON_HOST, () => {
      process.stderr.write(
        `uemcp-daemon ${SHIM_VERSION} listening on http://${DAEMON_HOST}:${DAEMON_PORT}\n`,
      );
      resolve();
    });
  });

  const idleTicker = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      process.stderr.write('uemcp-daemon: idle timeout, shutting down\n');
      shutdown();
    }
  }, 30_000);
  idleTicker.unref();

  const shutdown = (): void => {
    clearInterval(idleTicker);
    pool.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pool: UEPool,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '';

  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: SHIM_VERSION }));
    return;
  }

  if (method === 'GET' && url === '/api/list_editors') {
    const editors = pool.listEditors();
    const payload: Record<string, unknown> = {
      count: editors.length,
      editors,
    };
    if (editors.length === 0) {
      payload.hint =
        "No editors discovered. If UE is running, verify Python Script Plugin is enabled and 'Remote Execution' is on (Project Settings → Plugins → Python → 'Remote Execution'). uemcp relies on UE's built-in Python Remote Execution for UDP multicast discovery.";
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
    return;
  }

  if (method === 'POST' && url === '/api/run_python') {
    const body = await readBody(req);
    let parsed: { code?: unknown; editor?: unknown };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON body' }));
      return;
    }
    if (typeof parsed.code !== 'string') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: "missing required string field 'code'" }));
      return;
    }
    const editor = typeof parsed.editor === 'string' ? parsed.editor : undefined;
    const result = await pool.runPython(editor, parsed.code);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: `not found: ${method} ${url}` }));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
