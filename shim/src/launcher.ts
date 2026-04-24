// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Per-Claude-session stdio MCP server. Tool handlers forward to the singleton
// daemon over HTTP; if the daemon isn't running, daemonLifecycle spawns it
// detached and daemonClient retries once on network-level failures.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { ensureDaemonAlive } from './daemonLifecycle.js';
import { daemonGet, daemonPost } from './daemonClient.js';
import {
  DAEMON_HOST,
  DAEMON_PORT,
  MAX_WAIT_MS,
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
      'Each entry includes project name/path, engine version, and the node id. ' +
      'Requires UE to have Python Script Plugin enabled with "Remote Execution" ' +
      'turned on (Project Settings → Plugins → Python). If UE is running but this ' +
      'tool returns an empty list, that setting is the most likely cause — the ' +
      'response includes a `hint` field in that case. Use this to identify which ' +
      'editor to target with other tools when more than one is running. Pass ' +
      '`wait_ms` to block up to that many milliseconds for an editor to appear ' +
      '(useful right after launching UE).',
    {
      wait_ms: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_MS)
        .optional()
        .describe(
          'If set, block up to this many ms for at least one editor to be discovered before returning. Capped at the daemon-side max.',
        ),
    },
    async ({ wait_ms }) => {
      const query = wait_ms ? `?wait_ms=${wait_ms}` : '';
      const result = await daemonGet(`/api/list_editors${query}`);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.tool(
    'execute_python',
    'Execute Python code inside an Unreal Editor. Runs on the game thread with ' +
      'full access to the `unreal` module and any project-local scripting libraries ' +
      '(e.g. PyEditorTools). Returns { success, command_result, log_output }. ' +
      'Requires the target UE editor to have Python Script Plugin enabled with ' +
      '"Remote Execution" on. Use `editor` to target a specific UE when multiple ' +
      'are running; omit when only one editor is running. The daemon waits up to ' +
      '~2 s by default for discovery if no editors are yet visible, to absorb the ' +
      'race right after UE launch; override with `wait_ms`.',
    {
      code: z.string().describe('Python source to execute. Multi-line supported.'),
      editor: z
        .string()
        .optional()
        .describe(
          'Editor selector: project name, substring of project name, or substring of project path.',
        ),
      wait_ms: z
        .number()
        .int()
        .min(0)
        .max(MAX_WAIT_MS)
        .optional()
        .describe(
          'Override the default wait-for-discovery window (milliseconds) before failing with "no editor discovered".',
        ),
    },
    async ({ code, editor, wait_ms }) => {
      const payload: Record<string, unknown> = { code };
      if (editor !== undefined) payload.editor = editor;
      if (wait_ms !== undefined) payload.wait_ms = wait_ms;
      const result = await daemonPost('/api/run_python', payload);
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
