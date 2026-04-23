# Changelog

All notable changes to `@yuki-is-taka/uemcp` are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [0.2.0] — Unreleased

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

[0.2.0]: https://github.com/yuki-is-taka/uemcp-dev/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yuki-is-taka/uemcp-dev/releases/tag/v0.1.0
