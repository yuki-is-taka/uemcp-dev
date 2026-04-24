// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Singleton HTTP daemon. Holds the UE connection pool, exposes a minimal
// internal HTTP API that launchers (one per Claude session) relay into.
// Self-exits after IDLE_TIMEOUT_MS with no requests (unless UEMCP_KEEP_ALIVE).

import http from 'node:http';

import {
  DAEMON_HOST,
  DAEMON_PORT,
  DEFAULT_EXECUTE_WAIT_MS,
  IDLE_TIMEOUT_MS,
  KEEP_ALIVE,
  MAX_WAIT_MS,
  SHIM_VERSION,
} from './protocol.js';
import { UEPool } from './uePool.js';

export async function runDaemon(): Promise<void> {
  installLastResortHandlers();

  const pool = new UEPool();
  try {
    await pool.start();
  } catch (err) {
    process.stderr.write(
      `uemcp-daemon: failed to start UE pool: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
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

  let idleTicker: NodeJS.Timeout | null = null;
  if (!KEEP_ALIVE) {
    idleTicker = setInterval(() => {
      // Bump lastActivity on successful discovery events too — an editor being
      // actively discovered counts as "the daemon is doing useful work".
      const effective = Math.max(lastActivity, pool.lastDiscoveryAt);
      if (Date.now() - effective > IDLE_TIMEOUT_MS) {
        process.stderr.write('uemcp-daemon: idle timeout, shutting down\n');
        shutdown();
      }
    }, 30_000);
    idleTicker.unref();
  } else {
    process.stderr.write('uemcp-daemon: UEMCP_KEEP_ALIVE set, idle timeout disabled\n');
  }

  const shutdown = (): void => {
    if (idleTicker) clearInterval(idleTicker);
    pool.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Last-resort handlers: log the fault to stderr (which the launcher routes to
 * the daemon log file) then exit. We intentionally do NOT swallow these — an
 * uncaught error means state is potentially corrupt and respawning through
 * the launcher's daemonClient retry is safer than limping along. The file log
 * is the diagnostic artifact for next-day triage.
 */
function installLastResortHandlers(): void {
  process.on('uncaughtException', (err: Error) => {
    process.stderr.write(
      `uemcp-daemon: uncaughtException: ${err.stack ?? err.message}\n`,
    );
    process.exit(1);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    process.stderr.write(`uemcp-daemon: unhandledRejection: ${msg}\n`);
    process.exit(1);
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pool: UEPool,
): Promise<void> {
  const method = req.method ?? 'GET';
  const url = req.url ?? '';

  if (method === 'GET' && url.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        version: SHIM_VERSION,
        live_editors: pool.listEditors().length,
      }),
    );
    return;
  }

  if (method === 'GET' && url.startsWith('/api/list_editors')) {
    const waitMs = parseWaitMsFromQuery(url);
    if (waitMs > 0) await pool.waitForAnyEditor(waitMs);
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
    let parsed: { code?: unknown; editor?: unknown; wait_ms?: unknown };
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
    const waitMs = clampWaitMs(parsed.wait_ms, DEFAULT_EXECUTE_WAIT_MS);
    const result = await pool.runPython(editor, parsed.code, waitMs);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: `not found: ${method} ${url}` }));
}

/** Parse `?wait_ms=NNN` from a URL, returning 0 when absent or unparseable. */
function parseWaitMsFromQuery(url: string): number {
  const q = url.indexOf('?');
  if (q < 0) return 0;
  const params = new URLSearchParams(url.slice(q + 1));
  const raw = params.get('wait_ms');
  return clampWaitMs(raw, 0);
}

function clampWaitMs(raw: unknown, defaultMs: number): number {
  if (raw === undefined || raw === null || raw === '') return defaultMs;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return defaultMs;
  return Math.min(n, MAX_WAIT_MS);
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
