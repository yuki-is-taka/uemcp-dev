#!/usr/bin/env node
// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// uemcp — stdio MCP server that bridges Claude Code to running UE editors
// via the UEMCP plugin.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { Discovery } from './discovery.js';
import { getDiscoveryDir } from './paths.js';
import { PROTOCOL_VERSION, SHIM_VERSION } from './protocol.js';

async function main(): Promise<void> {
  const discoveryDir = getDiscoveryDir();
  const discovery = new Discovery(discoveryDir);
  await discovery.start();

  const server = new McpServer({
    name: 'uemcp',
    version: SHIM_VERSION,
  });

  server.tool(
    'list_unreal_editors',
    'List currently running Unreal Engine editors detected by UEMCP discovery. ' +
      'Each entry includes project name/path, engine version, PID, host/port ' +
      'of the MCP endpoint, and whether the editor is currently listening for ' +
      'MCP connections. Use this to find the editor you want to target with ' +
      'other tools.',
    {},
    // eslint-disable-next-line @typescript-eslint/require-await
    async () => {
      const editors = discovery.getEditors();
      const payload = {
        shim_version: SHIM_VERSION,
        shim_protocol_version: PROTOCOL_VERSION.string,
        discovery_dir: discoveryDir,
        count: editors.length,
        editors: editors.map((e) => ({
          project_name: e.project_name,
          project_path: e.project_path,
          engine_version: e.engine_version,
          plugin_protocol_version: e.protocol_version,
          pid: e.pid,
          host: e.host,
          port: e.port,
          listening: e.port > 0,
          started_at: e.started_at,
          ...(e.map !== undefined && { map: e.map }),
        })),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    `uemcp ${SHIM_VERSION} (protocol ${PROTOCOL_VERSION.string}) ready, watching ${discoveryDir}\n`,
  );

  const shutdown = async (): Promise<void> => {
    await discovery.stop();
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `uemcp fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
