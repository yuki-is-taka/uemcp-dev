// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Lazy connection manager for UEMCP editors. Opens TCP + performs handshake
// on first use and caches the client per pid. Next call reuses; on a dropped
// socket, next call reconnects.

import type { DiscoveredEditor } from './discovery.js';
import { PROTOCOL_VERSION, SHIM_VERSION } from './protocol.js';
import { JsonRpcClient } from './rpcClient.js';

interface PoolEntry {
  pid: number;
  port: number;
  client: JsonRpcClient;
}

export class EditorPool {
  private readonly entries = new Map<number, PoolEntry>();

  async getOrOpen(editor: DiscoveredEditor): Promise<JsonRpcClient> {
    const existing = this.entries.get(editor.pid);
    if (existing && existing.port === editor.port && existing.client.isAlive()) {
      return existing.client;
    }
    if (existing) {
      existing.client.close();
      this.entries.delete(editor.pid);
    }
    if (editor.port <= 0) {
      throw new Error(
        `Editor ${editor.project_name} (pid ${editor.pid}) is not listening for MCP yet (port=0). ` +
          `The TCP server may not have started. Check UEMCP settings or wait a moment and retry.`,
      );
    }

    const client = await JsonRpcClient.connect(editor.host, editor.port);
    try {
      await client.call('mcp.handshake', {
        protocol_version: PROTOCOL_VERSION.string,
        client: 'uemcp',
        client_version: SHIM_VERSION,
      });
    } catch (err) {
      client.close();
      throw err;
    }

    this.entries.set(editor.pid, { pid: editor.pid, port: editor.port, client });
    return client;
  }

  closeAll(): void {
    for (const { client } of this.entries.values()) {
      client.close();
    }
    this.entries.clear();
  }
}
