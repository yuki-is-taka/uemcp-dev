# UEMCP (plugin)

Editor-only UE plugin that exposes `UFUNCTION(BlueprintCallable)` methods to
Claude Code (or any MCP client) via a local TCP endpoint. Pairs with the
`@yuki-is-taka/uemcp` Node shim, which handles discovery, auto-reconnect, and
natural-language editor selection.

## Installation

```bash
cd YourProject/Plugins
git clone https://github.com/yuki-is-taka/uemcp.git UEMCP
```

Regenerate project files, build the editor, enable the plugin if necessary.
Python Script Plugin is a hard dependency and must be enabled in your project.

## Settings

Project Settings → Plugins → UEMCP:

| Setting | Default | Purpose |
|---|---|---|
| Enable | true (Editor), false (Shipping) | Master switch |
| Listen Address | `127.0.0.1` | Loopback-only by default |
| Listen Port | `0` (OS-assigned) | Fix to a port only if needed |
| Exposed Class Prefixes | `["U*ScriptingLibrary"]` | Which classes' UFUNCTIONs get published |
| Readonly Mode | false | Disable all mutating tools |
| Always Expose ExecutePython | true | Keep the raw Python escape hatch |

## Security

The plugin listens on loopback only by default and the module type is `Editor`,
so it is not compiled into shipping builds. For network use, add a token-based
authentication layer (not implemented in 0.1.x).

## Development

This plugin is developed in the
[uemcp-dev](https://github.com/yuki-is-taka/uemcp-dev) monorepo. **This
repository is auto-generated from that monorepo's `plugin/` subtree** — please
open issues and PRs against `uemcp-dev`, not here.
