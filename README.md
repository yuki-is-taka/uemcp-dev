# uemcp

stdio MCP server that bridges Claude Code (and other MCP clients) to running
Unreal Engine editors. Claude spawns a thin launcher per session; on first use
the launcher auto-starts a singleton local HTTP daemon that holds the shared
connection to UE via its built-in Python Remote Execution.

No UE-side plugin is required. The editor just needs Python Script Plugin
enabled with "Remote Execution" on (Project Settings → Plugins → Python).

## Architecture

```
Claude Code session A ─ stdio ─→ launcher A ┐
Claude Code session B ─ stdio ─→ launcher B ┼─ HTTP (127.0.0.1:8877) ─→ uemcp-daemon
Claude Code session C ─ stdio ─→ launcher C ┘                               ↓
                                                              UDP multicast (239.0.0.1:6766)
                                                                            ↓
                                                          UE editor(s) with Python RE enabled
```

- **launcher**: registered in Claude Code as a stdio MCP server. Forwards tool
  calls to the daemon; if no daemon is reachable, spawns one detached.
- **daemon**: singleton HTTP server on loopback. Holds the Python RE client,
  serializes commands, self-exits after 30 minutes of inactivity.

Both are published in a single npm package `@yuki-is-taka/uemcp`, routed by
argv from the same bin entry.

## Installation

```bash
npm install -g @yuki-is-taka/uemcp
```

Global Claude Code MCP config (`~/.claude/settings.json` or equivalent):

```json
{
  "mcpServers": {
    "uemcp": {
      "type": "stdio",
      "command": "uemcp"
    }
  }
}
```

Or, without global install:

```json
{
  "mcpServers": {
    "uemcp": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@yuki-is-taka/uemcp"]
    }
  }
}
```

No per-project config is needed — the daemon discovers every running UE editor
(with Python RE enabled) on the same loopback via UDP multicast.

## Configuration

Environment variables (read by both launcher and daemon):

| Variable | Default | Purpose |
|---|---|---|
| `UEMCP_HOST` | `127.0.0.1` | Daemon bind + launcher probe host |
| `UEMCP_PORT` | `8877` | Daemon TCP port |
| `UEMCP_DAEMON_START_TIMEOUT_MS` | `10000` | How long the launcher waits for a spawned daemon to come up |
| `UEMCP_IDLE_TIMEOUT_MS` | `1800000` | Daemon self-exit after this many ms of no HTTP activity (default 30 min) |

## Tools exposed

- `list_unreal_editors` — lists every running UE editor discovered on the
  loopback multicast group. Empty list when none are running.
- `execute_python` — runs Python code inside the selected UE editor's game
  thread. Multi-line supported. Takes an optional `editor` selector (project
  name, substring match) to pick between multiple running editors.

Additional curated tools will be added as concrete needs surface.

## Development

```bash
git clone https://github.com/yuki-is-taka/uemcp-dev.git
cd uemcp-dev/shim
npm install
npm run build
npm link                 # use the dev build in Claude Code
```

The published npm package name is `@yuki-is-taka/uemcp`; this repo publishes
it from `shim/` on tagged releases via `.github/workflows/publish-shim.yml`.

## Repository layout

```
.
├── shim/                   # the npm package @yuki-is-taka/uemcp
│   ├── package.json
│   └── src/
│       ├── index.ts        # bin entry; routes to launcher or daemon
│       ├── launcher.ts     # stdio MCP server, forwards to daemon
│       ├── daemon.ts       # HTTP API server
│       ├── daemonClient.ts # launcher → daemon HTTP client
│       ├── uePool.ts       # unreal-remote-execution wrapper
│       ├── protocol.ts     # version + env-configurable constants
│       └── selector.ts     # fuzzy editor selector
└── .github/workflows/
    ├── ci.yml              # typecheck + build on every push
    └── publish-shim.yml    # npm publish on v* tags
```

## History

Earlier iterations of this project included a custom UE Editor plugin that
hosted its own MCP server via a bespoke TCP/JSON-RPC protocol. That approach
was retired when review showed its stated advantages (UFUNCTION reflection
auto-tooling, engine-side event push, transaction integration) were either
rejected by follow-up design work or equally reachable through Python
Remote Execution. The current design uses UE's stock Python RE + a Node
daemon for fan-in, giving the same user-visible functionality with far less
engine coupling.
