# UEMCP wire protocol

The UEMCP plugin and the `uemcp` shim communicate over a single local TCP
connection using JSON-RPC 2.0 (newline-delimited, UTF-8). The shim translates
this into MCP proper for Claude Code, but the UE-side endpoint is
intentionally simpler than MCP's Streamable HTTP transport to keep
engine-side implementation small.

**Current version:** `0.1.0`

## Versioning policy

The protocol version covers:

- RPC envelope shape
- Discovery file format
- Error object shape
- Handshake behavior

It does **not** cover:

- The set of exposed tools (discovered at runtime)
- Tool parameter schemas (discovered at runtime)
- Tool result shapes (declared per-tool in the schema)

So adding / renaming / modifying tools does not require a protocol version
bump. Only changes to the above four categories do.

Semver rules:

- **Major** bump on any breaking change to the above.
- **Minor** bump on backward-compatible additions (new envelope fields,
  new optional discovery keys).
- **Patch** bump on clarifications / bug-fix-only changes.

The shim checks compatibility on connect: it rejects any plugin whose protocol
major is higher than what the shim knows about, and logs a warning on a minor
gap.

## Discovery file

When the plugin starts, it writes:

```
%LOCALAPPDATA%/UnrealMcp/instances/{pid}.json
```

(on Windows; equivalent `$XDG_STATE_HOME/UnrealMcp/instances/{pid}.json` on
Linux, `~/Library/Application Support/UnrealMcp/instances/{pid}.json` on
macOS).

```json
{
  "protocol_version": "0.1.0",
  "pid": 12840,
  "project_name": "EightyEight",
  "project_path": "C:/Users/yukii/Perforce/EightyEight",
  "engine_version": "5.7.0",
  "map": "/Game/Maps/L_Stage_Opening",
  "host": "127.0.0.1",
  "port": 49234,
  "started_at": "2026-04-22T14:32:01Z"
}
```

On clean shutdown the plugin deletes this file. On crash, the shim cleans up
stale files by checking `pid` liveness on its next scan.

## Handshake

First message from shim to plugin:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "mcp.handshake",
  "params": {
    "protocol_version": "0.1.0",
    "client": "uemcp",
    "client_version": "0.1.0"
  }
}
```

Plugin response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocol_version": "0.1.0",
    "server": "UEMCP",
    "server_version": "0.1.0",
    "session_id": "..."
  }
}
```

If protocol versions are incompatible, plugin responds with a JSON-RPC error
(code `-32000`, message `protocol_version_mismatch`).

## Tool listing

```json
{ "jsonrpc": "2.0", "id": 2, "method": "mcp.list_tools" }
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "state_tree_scripting__create_state_tree_asset",
        "description": "...",
        "input_schema": { "type": "object", "properties": { ... } },
        "output_schema": { ... }
      }
    ]
  }
}
```

## Tool invocation

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "mcp.call_tool",
  "params": {
    "name": "state_tree_scripting__create_state_tree_asset",
    "arguments": { ... }
  }
}
```

Response `result` contains the tool's structured return value (an object
matching `output_schema`). Tool-level errors use JSON-RPC error objects.

## Error codes

| Code | Meaning |
|---|---|
| `-32700` | Parse error (invalid JSON) |
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32602` | Invalid params |
| `-32603` | Internal error |
| `-32000` | Protocol version mismatch |
| `-32001` | Tool not found |
| `-32002` | Tool execution failed (structured `data` field carries UE-side diagnostics) |
| `-32003` | Game thread dispatch timeout |
