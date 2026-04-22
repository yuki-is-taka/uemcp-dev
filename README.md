# uemcp (dev monorepo)

Development home for **UEMCP** — a UE Editor plugin that exposes
`UFUNCTION(BlueprintCallable)` methods to Claude Code and other MCP clients,
paired with a Node-based stdio MCP server (`uemcp`) that discovers running
editors and proxies requests to the right one.

## Why this exists

Claude Code's default Unreal MCP integration goes through UE's built-in Python
Remote Execution, which has two pain points: no auto-reconnect after editor
restart, and a hard "one MCP client per UE editor" exclusion that makes
multi-session / multi-editor workflows awkward. This project replaces the
transport entirely with a plugin-hosted MCP endpoint + a thin discovery shim,
giving transparent reconnect, multi-editor awareness, and natural-language
editor selection.

## Repository layout

```
.
├── plugin/                 # UE Editor plugin (C++), module name: UEMCP
│   ├── UEMCP.uplugin
│   └── Source/UEMCP/
├── shim/                   # Node stdio MCP server (TypeScript), CLI: uemcp
│   ├── package.json
│   └── src/
├── docs/
│   └── PROTOCOL.md         # shared contract between plugin and shim
└── .github/workflows/      # release automation
```

**This repo is the primary development surface.** The plugin and shim are
paired — protocol changes, tool schema changes, and breaking revisions are
expected to land as single PRs touching both sides. Keep them versioned
together with a single semver tag.

## Release pipeline (subtree split)

Tagging `vX.Y.Z` fires two workflows:

1. **`publish-plugin.yml`** — `git subtree split --prefix=plugin` and force-push
   the split branch to the consumer repo
   `https://github.com/yuki-is-taka/uemcp.git` as `main`. Users clone that
   repo directly into `Plugins/UEMCP`.
2. **`publish-shim.yml`** — `npm publish` from `shim/` to
   `@yuki-is-taka/uemcp`.

Both are consumers of the same commit, same tag.

## Installation (user-facing)

```bash
# In your UE project
cd MyProject/Plugins
git clone https://github.com/yuki-is-taka/uemcp.git UEMCP

# In your global Claude Code MCP config (~/.claude/settings.json)
{
  "mcpServers": {
    "unreal": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@yuki-is-taka/uemcp"]
    }
  }
}
```

No per-project config needed — the shim auto-discovers running editors via
`%LOCALAPPDATA%/UnrealMcp/instances/`.

After a global install (`npm i -g @yuki-is-taka/uemcp`) the config simplifies to:

```json
{ "mcpServers": { "unreal": { "type": "stdio", "command": "uemcp" } } }
```

## Development

```bash
# Shim
cd shim
npm install
npm run build
npm link                 # use the dev build in Claude Code

# Plugin
# Open the .uplugin in a UE project that has it under Plugins/UEMCP/, build via
# IDE or Live Coding. Iteration cycle is UE-native.
```

## Protocol compatibility

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the wire contract. Tool schemas
are discovered at runtime, so tool-level changes do not require a protocol
version bump — only envelope / discovery-file / error-shape changes do.
