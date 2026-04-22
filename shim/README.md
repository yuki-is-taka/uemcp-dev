# @yuki-is-taka/uemcp

stdio MCP server that bridges Claude Code to running Unreal Engine editors
via the [UEMCP plugin](https://github.com/yuki-is-taka/uemcp). Handles
auto-discovery of running editors, transparent reconnect on editor restart,
and natural-language editor selection across multiple running projects.

## Installation

```bash
# Global install (recommended)
npm install -g @yuki-is-taka/uemcp

# Or let Claude Code pull it on demand via npx
```

## Claude Code configuration

`~/.claude/settings.json` (or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "unreal": {
      "type": "stdio",
      "command": "uemcp"
    }
  }
}
```

Or without global install:

```json
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

## How it works

The shim watches a discovery directory for `*.json` files written by each
running UEMCP plugin instance:

```
Windows: %LOCALAPPDATA%/UnrealMcp/instances/
macOS:   ~/Library/Application Support/UnrealMcp/instances/
Linux:   $XDG_STATE_HOME/UnrealMcp/instances/
```

When Claude Code calls a tool, the shim routes it to the right editor based
on the `editor?` argument (fuzzy project-name match), or to the session
default, or to the only running one if unambiguous.

## Development

This package is developed in the
[uemcp-dev](https://github.com/yuki-is-taka/uemcp-dev) monorepo.

```bash
git clone https://github.com/yuki-is-taka/uemcp-dev.git
cd uemcp-dev/shim
npm install
npm run build
npm link
```
