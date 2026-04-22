// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Minimal JSON-RPC 2.0 client over a newline-delimited TCP connection.
// Matches the envelope produced by the UEMCP plugin's C++ side.

import net from 'node:net';

export interface JsonRpcErrorShape {
  code: number;
  message: string;
  data?: unknown;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(err: JsonRpcErrorShape) {
    super(`${err.message} (code ${err.code})`);
    this.name = 'RpcError';
    this.code = err.code;
    this.data = err.data;
  }
}

export class JsonRpcClient {
  private readonly socket: net.Socket;
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.setEncoding('utf8');
    this.socket.on('data', (data: string) => {
      this.onData(data);
    });
    this.socket.on('close', () => {
      this.handleClose(new Error('Connection closed'));
    });
    this.socket.on('error', (err: Error) => {
      this.handleClose(err);
    });
  }

  static connect(host: string, port: number, timeoutMs = 5000): Promise<JsonRpcClient> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connect timeout to ${host}:${port} after ${timeoutMs}ms`));
      }, timeoutMs);
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.removeAllListeners('error');
        resolve(new JsonRpcClient(socket));
      });
    });
  }

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      throw new Error('JsonRpcClient is closed');
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const req =
        params === undefined
          ? { jsonrpc: '2.0', id, method }
          : { jsonrpc: '2.0', id, method, params };
      this.socket.write(`${JSON.stringify(req)}\n`);
    });
  }

  isAlive(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.rejectAllPending(new Error('JsonRpcClient closed by caller'));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) return;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let msg: {
      jsonrpc?: string;
      id?: number;
      result?: unknown;
      error?: JsonRpcErrorShape;
    };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.id !== 'number') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(new RpcError(msg.error));
    } else {
      p.resolve(msg.result);
    }
  }

  private handleClose(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAllPending(err);
  }

  private rejectAllPending(err: unknown): void {
    for (const { reject } of this.pending.values()) {
      reject(err);
    }
    this.pending.clear();
  }
}
