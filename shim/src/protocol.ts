// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Version constants and runtime-env-configurable endpoints shared between
// the launcher (stdio MCP, per-session) and the daemon (HTTP API, singleton).

export const PROTOCOL_VERSION = {
  major: 0,
  minor: 2,
  patch: 2,
  string: '0.2.2',
} as const;

export const SHIM_VERSION = '0.2.2';

export const DAEMON_HOST = process.env.UEMCP_HOST ?? '127.0.0.1';
export const DAEMON_PORT = Number(process.env.UEMCP_PORT ?? 8877);

/** How long the launcher waits after spawning the daemon before giving up. */
export const DAEMON_START_TIMEOUT_MS = Number(
  process.env.UEMCP_DAEMON_START_TIMEOUT_MS ?? 10_000,
);

/** How long a single `/health` probe may hang before declared unreachable. */
export const DAEMON_HEALTH_TIMEOUT_MS = Number(
  process.env.UEMCP_DAEMON_HEALTH_TIMEOUT_MS ?? 800,
);

/**
 * Daemon self-exits after this long with no HTTP activity. Default is 8h —
 * the old 30m value was killing healthy daemons while an editor was still up
 * and forcing a cold respawn on the next tool call. Set UEMCP_KEEP_ALIVE=1 to
 * disable the idle timer entirely.
 */
export const IDLE_TIMEOUT_MS = Number(
  process.env.UEMCP_IDLE_TIMEOUT_MS ?? 8 * 60 * 60 * 1000,
);

/** When truthy, the daemon never self-exits on idle. */
export const KEEP_ALIVE =
  (process.env.UEMCP_KEEP_ALIVE ?? '').toLowerCase() === '1' ||
  (process.env.UEMCP_KEEP_ALIVE ?? '').toLowerCase() === 'true';

/**
 * UDP-multicast ping interval (ms) while at least one editor is visible. The
 * `unreal-remote-execution` library uses this as the "are you still there"
 * heartbeat cadence.
 */
export const DISCOVERY_INTERVAL_WARM_MS = Number(
  process.env.UEMCP_DISCOVERY_INTERVAL_WARM_MS ?? 5000,
);

/**
 * Shorter ping interval used when zero editors are currently visible. Shrinks
 * first-seen latency right after `UnrealEditor.exe` finishes booting. Switched
 * back to the warm cadence once an editor responds.
 */
export const DISCOVERY_INTERVAL_COLD_MS = Number(
  process.env.UEMCP_DISCOVERY_INTERVAL_COLD_MS ?? 1000,
);

/** Upper bound on `wait_ms` passed to list_editors / execute_python. */
export const MAX_WAIT_MS = Number(process.env.UEMCP_MAX_WAIT_MS ?? 120_000);

/** Default `wait_ms` for execute_python when the caller omits it. */
export const DEFAULT_EXECUTE_WAIT_MS = Number(
  process.env.UEMCP_DEFAULT_EXECUTE_WAIT_MS ?? 2000,
);

/**
 * Log file rotation configuration. Applied once at daemon spawn time by
 * `openDaemonLogForSpawn()` — rotate if the current log exceeds the size
 * cap, keep up to `RETAIN_COUNT` rotated copies.
 */
export const LOG_FILE_MAX_BYTES = Number(
  process.env.UEMCP_LOG_MAX_BYTES ?? 5 * 1024 * 1024,
);
export const LOG_FILE_RETAIN_COUNT = Number(
  process.env.UEMCP_LOG_RETAIN ?? 3,
);
