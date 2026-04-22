// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Version constants and runtime-env-configurable endpoints shared between
// the launcher (stdio MCP, per-session) and the daemon (HTTP API, singleton).

export const PROTOCOL_VERSION = {
  major: 0,
  minor: 2,
  patch: 0,
  string: '0.2.0',
} as const;

export const SHIM_VERSION = '0.2.0';

export const DAEMON_HOST = process.env.UEMCP_HOST ?? '127.0.0.1';
export const DAEMON_PORT = Number(process.env.UEMCP_PORT ?? 8877);

/** How long the launcher waits after spawning the daemon before giving up. */
export const DAEMON_START_TIMEOUT_MS = Number(
  process.env.UEMCP_DAEMON_START_TIMEOUT_MS ?? 10_000,
);

/** Daemon self-exits after this long with no HTTP activity. */
export const IDLE_TIMEOUT_MS = Number(
  process.env.UEMCP_IDLE_TIMEOUT_MS ?? 30 * 60 * 1000,
);
