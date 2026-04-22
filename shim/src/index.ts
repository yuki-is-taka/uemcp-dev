#!/usr/bin/env node
// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// uemcp — stdio MCP server that bridges Claude Code to running UE editors
// via the UEMCP plugin.

import { PROTOCOL_VERSION, SHIM_VERSION } from './protocol.js';

async function main(): Promise<void> {
  // TODO(0.2): initialize MCP stdio server via @modelcontextprotocol/sdk.
  // TODO(0.2): start discovery watcher on %LOCALAPPDATA%/UnrealMcp/instances/.
  // TODO(0.2): register proxy tools (list_unreal_editors, select_unreal_editor,
  //            execute_python, plus dynamically discovered tools from plugin).
  // TODO(0.2): route tool calls to the selected UE instance's TCP endpoint.

  process.stderr.write(
    `uemcp ${SHIM_VERSION} (protocol ${PROTOCOL_VERSION.string}) — not yet implemented\n`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`uemcp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
