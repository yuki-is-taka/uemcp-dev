#!/usr/bin/env node
// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Entry point. Routes to launcher (stdio MCP surface for Claude Code) or
// daemon (HTTP API + UE Python Remote Execution) based on argv.

import { runDaemon } from './daemon.js';
import { runLauncher } from './launcher.js';

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'daemon') {
    await runDaemon();
  } else {
    await runLauncher();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `uemcp fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
