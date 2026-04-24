# Changelog

All notable changes to `@yuki-is-taka/uemcp` are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [0.2.2] — Unreleased

### Added
- `list_unreal_editors` and `execute_python` accept an optional `wait_ms`
  argument. `execute_python` also waits up to 2 s by default so the common
  "run Python right after launching UE" race no longer fails spuriously.
  Capped at `UEMCP_MAX_WAIT_MS` (default 120 s).
- `UEMCP_KEEP_ALIVE=1` disables the daemon's idle self-exit entirely.
- `/health` response now includes `live_editors` count for richer health
  probing from the launcher side.
- Daemon stderr is routed to a rotating log file at
  `~/.uemcp/logs/daemon.log` (5 MB × 3 rotations by default, tunable via
  `UEMCP_LOG_MAX_BYTES` / `UEMCP_LOG_RETAIN`). Previously daemon output was
  discarded, leaving silent crashes unobservable.

### Changed
- `daemonClient` now retries once on network-level errors
  (`ECONNREFUSED` / `ECONNRESET` / `ETIMEDOUT` / `EPIPE`) after calling
  `ensureDaemonAlive`. Previously a daemon that died between tool calls
  caused every subsequent call in the same session to fail. 4xx/5xx
  responses are still surfaced immediately — only socket-layer errors
  trigger a respawn-and-retry.
- Discovery UDP-multicast ping cadence is adaptive: 1 s while no editors
  are visible, 5 s once at least one responds. Shortens the first-seen
  latency right after UE launch without paying steady-state cost.
- Idle timeout default bumped from 30 min to 8 h, and editor-discovery
  activity now counts toward "not idle". The previous 30 min value was
  killing healthy daemons while an editor was open but Claude was paused.
- The daemon installs `uncaughtException` / `unhandledRejection` handlers
  that log the stack to the daemon log file and exit(1). Launcher retry
  will respawn cleanly on the next tool call, and the log preserves the
  fault for post-mortem. Rexec event listeners are individually wrapped
  so library internals don't directly crash the daemon.

## [0.2.1] — 2026-04-23

### Added
- `list_unreal_editors` now returns a `hint` field when no editors are
  discovered, pointing users at the Python Script Plugin "Remote Execution"
  setting which is the most common cause.
- Tool descriptions now explicitly mention the Python RE prerequisite so
  coding agents can steer users toward the fix proactively.

### Changed
- Switched npm publishing from a long-lived token to Trusted Publishing
  (OIDC) with `--provenance` attestation. First release published via OIDC.

## [0.2.0] — 2026-04-22

### Changed
- Replaced the UE-side plugin + custom TCP/JSON-RPC transport with a
  launcher/daemon architecture that uses UE's built-in Python Remote Execution.
  The npm package now contains both components (launcher for per-session
  stdio MCP, daemon for singleton fan-in), routed by argv.
- Discovery now uses UE's native UDP multicast (via `unreal-remote-execution`)
  instead of the plugin-written discovery files under `%LOCALAPPDATA%`.

### Removed
- The `plugin/` subtree (UE Editor plugin) and the associated
  `publish-plugin.yml` subtree-split workflow.
- The `docs/PROTOCOL.md` wire-contract doc (no longer a custom protocol).
- The `verify-secrets.yml` workflow (`CONSUMER_REPO_TOKEN` is no longer used).
- `chokidar` dependency (no file-based discovery).

### Added
- `unreal-remote-execution` dependency.
- Runtime-configurable endpoints via `UEMCP_HOST`, `UEMCP_PORT`,
  `UEMCP_DAEMON_START_TIMEOUT_MS`, `UEMCP_IDLE_TIMEOUT_MS`.
- Daemon idle self-exit after 30 minutes of inactivity.

## [0.1.0] — 2026-04-22

### Added
- Initial monorepo scaffolding with UE plugin + stdio shim + custom
  TCP/JSON-RPC protocol. Retired in 0.2.0.

[0.2.1]: https://github.com/yuki-is-taka/uemcp-dev/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yuki-is-taka/uemcp-dev/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yuki-is-taka/uemcp-dev/releases/tag/v0.1.0
