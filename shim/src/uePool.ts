// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Wraps the `unreal-remote-execution` library to discover running UE editors
// via UDP multicast and serialize Python command execution through a single
// TCP command connection. Owned by the singleton daemon.

import {
  RemoteExecution,
  RemoteExecutionConfig,
  type RemoteExecutionNode,
} from 'unreal-remote-execution';

import { resolveEditor, type EditorSummaryLite } from './selector.js';

export interface EditorSummary extends EditorSummaryLite {
  engine_version: string;
  engine_root: string;
  user: string;
  machine: string;
  last_seen: string;
}

export interface PythonResult {
  success: boolean;
  command_result: string;
  log_output: Array<{ type: string; output: string }>;
}

export class UEPool {
  private readonly rexec: RemoteExecution;
  private readonly queue = new SerialQueue();
  private connectedNodeId: string | null = null;

  constructor() {
    // TTL 1, loopback multicast interface. Matches UE's default remote execution settings.
    this.rexec = new RemoteExecution(
      new RemoteExecutionConfig(1, ['239.0.0.1', 6766], '0.0.0.0'),
    );
  }

  async start(): Promise<void> {
    await this.rexec.start();
    // Keep searching continuously so the set of known nodes stays live. The
    // library filters nodes that don't pong for ~5s so stale ones drop off.
    this.rexec.startSearchingForNodes(5000);
    this.rexec.events.addEventListener('commandConnectionClosed', () => {
      this.connectedNodeId = null;
    });
  }

  stop(): void {
    try {
      this.rexec.stop();
    } catch {
      // ignore
    }
  }

  listEditors(): EditorSummary[] {
    return this.rexec.remoteNodes.map((n) => this.toSummary(n));
  }

  async runPython(selector: string | undefined, code: string): Promise<PythonResult> {
    return this.queue.enqueue(async () => {
      const node = this.resolveNodeLive(selector);
      await this.ensureConnection(node);
      const result = await this.rexec.runCommand(code, true, 'ExecuteFile' as never);
      const resultAny = result as {
        success?: boolean;
        result?: string;
        output?: Array<{ type?: string; output?: string }>;
      };
      const logOutput = (resultAny.output ?? []).map((l) => ({
        type: String(l.type ?? 'Info'),
        output: String(l.output ?? ''),
      }));
      return {
        success: Boolean(resultAny.success),
        command_result: String(resultAny.result ?? ''),
        log_output: logOutput,
      };
    });
  }

  private toSummary(n: RemoteExecutionNode): EditorSummary {
    // The library marks some fields private but we need the data payload and
    // the last-pong timestamp for summaries. Go through `unknown` to sidestep
    // the narrow published interface without relying on it.
    const raw = n as unknown as {
      data?: Record<string, unknown>;
      lastPong?: number;
    };
    const data = raw.data ?? {};
    const lastPong = typeof raw.lastPong === 'number' ? raw.lastPong : Date.now();
    return {
      project_name: String(data.project_name ?? ''),
      project_path: String(data.project_root ?? ''),
      engine_version: String(data.engine_version ?? ''),
      engine_root: String(data.engine_root ?? ''),
      user: String(data.user ?? ''),
      machine: String(data.machine ?? ''),
      nodeId: n.nodeId,
      last_seen: new Date(lastPong).toISOString(),
    };
  }

  /** Resolve to a currently-live RemoteExecutionNode using the editor summary as the selection universe. */
  private resolveNodeLive(selector: string | undefined): RemoteExecutionNode {
    const summaries = this.listEditors();
    const chosen = resolveEditor(summaries, selector);
    const node = this.rexec.remoteNodes.find((n) => n.nodeId === chosen.nodeId);
    if (!node) {
      throw new Error(
        `Selected editor ${chosen.project_name} (nodeId ${chosen.nodeId}) is no longer reachable`,
      );
    }
    return node;
  }

  private async ensureConnection(node: RemoteExecutionNode): Promise<void> {
    if (this.connectedNodeId === node.nodeId && this.rexec.hasCommandConnection()) {
      return;
    }
    if (this.rexec.hasCommandConnection()) {
      this.rexec.closeCommandConnection();
    }
    // `stopSearching=false` keeps discovery running so other editors stay
    // visible while we command this one.
    await this.rexec.openCommandConnection(node, false);
    this.connectedNodeId = node.nodeId;
  }
}

/** Serializes async work so commands don't overlap on the single TCP connection. */
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
