// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Per-Claude-session stdio MCP server. Tool handlers forward to the singleton
// daemon over HTTP; if the daemon isn't running, this spawns it detached.

import { spawn } from 'node:child_process';
import http from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { daemonGet, daemonPost } from './daemonClient.js';
import {
  DAEMON_HOST,
  DAEMON_PORT,
  DAEMON_START_TIMEOUT_MS,
  PROTOCOL_VERSION,
  SHIM_VERSION,
} from './protocol.js';

export async function runLauncher(): Promise<void> {
  await ensureDaemonAlive();

  const server = new McpServer({
    name: 'uemcp',
    version: SHIM_VERSION,
  });

  server.tool(
    'list_unreal_editors',
    'List currently running Unreal Engine editors discovered via UDP multicast. ' +
      'Each entry includes project name/path, engine version, and the node id that ' +
      'identifies the editor for subsequent tool calls. Use this to identify which ' +
      'editor to target when more than one is running.',
    {},
    async () => {
      const result = await daemonGet('/api/list_editors');
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'execute_python',
    'Execute Python code inside an Unreal Editor. Runs on the game thread with ' +
      'full access to the `unreal` module and any project-local scripting libraries ' +
      '(e.g. PyEditorTools). Returns { success, command_result, log_output }. Use ' +
      '`editor` to target a specific UE when multiple are running; omit when only ' +
      'one editor is running.',
    {
      code: z.string().describe('Python source to execute. Multi-line supported.'),
      editor: z
        .string()
        .optional()
        .describe(
          'Editor selector: project name, substring of project name, or substring of project path.',
        ),
    },
    async ({ code, editor }) => {
      const result = await daemonPost('/api/run_python', { code, editor });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `uemcp launcher ${SHIM_VERSION} (protocol ${PROTOCOL_VERSION.string}) → daemon http://${DAEMON_HOST}:${DAEMON_PORT}\n`,
  );
}

async function ensureDaemonAlive(): Promise<void> {
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

async function isDaemonAlive(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = http.request(
      {
        host: DAEMON_HOST,
        port: DAEMON_PORT,
        path: '/health',
        method: 'GET',
        timeout: 800,
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

function spawnDaemonDetached(): void {
  const entry = process.argv[1];
  if (!entry) {
    throw new Error('Cannot spawn daemon: process.argv[1] is unset');
  }
  const child = spawn(process.execPath, [entry, 'daemon'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
