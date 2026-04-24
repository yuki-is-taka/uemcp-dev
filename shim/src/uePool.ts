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

import {
  DISCOVERY_INTERVAL_COLD_MS,
  DISCOVERY_INTERVAL_WARM_MS,
  MAX_WAIT_MS,
} from './protocol.js';
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

/** Listener on the rexec event bus — typed loosely to match the library's DOM-ish emitter. */
type RexecEventListener = (event: unknown) => void;

export class UEPool {
  private readonly rexec: RemoteExecution;
  private readonly queue = new SerialQueue();
  private connectedNodeId: string | null = null;
  /** Current ping cadence; adapts between cold (0 nodes) and warm (≥1). */
  private currentPingIntervalMs: number = DISCOVERY_INTERVAL_COLD_MS;
  /** Waiters on `waitForAnyEditor` — resolved once a fresh node appears. */
  private readonly editorWaiters = new Set<() => void>();
  /** Poll timer that recomputes `currentPingIntervalMs` from live-node count. */
  private intervalTicker: NodeJS.Timeout | null = null;
  /** Tracker for discovery-activity-based last-seen bump. */
  public lastDiscoveryAt: number = 0;

  constructor() {
    // TTL 1, loopback multicast interface. Matches UE's default remote execution settings.
    this.rexec = new RemoteExecution(
      new RemoteExecutionConfig(1, ['239.0.0.1', 6766], '0.0.0.0'),
    );
  }

  async start(): Promise<void> {
    await this.rexec.start();
    this.rexec.startSearchingForNodes(this.currentPingIntervalMs);
    this.addSafeListener('commandConnectionClosed', () => {
      this.connectedNodeId = null;
    });
    // The library doesn't expose a typed "nodeFound" event, but pinging always
    // refreshes `remoteNodes`, so we drive adaptive cadence and waiter wake-up
    // from a 500ms poll. Cheap and robust even if the library's internal event
    // schema changes between versions.
    this.intervalTicker = setInterval(() => {
      try {
        this.tickAdaptive();
      } catch (err) {
        logAsyncFailure('UEPool.tickAdaptive', err);
      }
    }, 500);
    this.intervalTicker.unref();
  }

  stop(): void {
    if (this.intervalTicker) {
      clearInterval(this.intervalTicker);
      this.intervalTicker = null;
    }
    // Unblock any pending waiters so the process can exit cleanly.
    this.editorWaiters.forEach((resolve) => resolve());
    this.editorWaiters.clear();
    try {
      this.rexec.stop();
    } catch {
      // ignore
    }
  }

  listEditors(): EditorSummary[] {
    return this.freshNodes().map((n) => this.toSummary(n));
  }

  async runPython(
    selector: string | undefined,
    code: string,
    waitMs: number = 0,
  ): Promise<PythonResult> {
    if (waitMs > 0) {
      // Give a freshly-launched editor a chance to be discovered before we
      // fail hard. Only waits if no live nodes are visible yet.
      await this.waitForAnyEditor(waitMs);
    }
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

  /**
   * Block until at least one live editor is visible or the timeout elapses.
   * Returns fast when editors are already present. Used by `execute_python`
   * (default 2s wait for post-launch race) and optionally by `list_editors`.
   */
  async waitForAnyEditor(timeoutMs: number): Promise<void> {
    if (this.freshNodes().length > 0) return;
    const capped = Math.min(Math.max(0, timeoutMs), MAX_WAIT_MS);
    if (capped === 0) return;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.editorWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, capped);
      timer.unref();
      this.editorWaiters.add(finish);
    });
  }

  private tickAdaptive(): void {
    const live = this.freshNodes().length;
    if (live > 0) {
      this.lastDiscoveryAt = Date.now();
      // Wake all waiters.
      this.editorWaiters.forEach((resolve) => resolve());
      this.editorWaiters.clear();
    }
    const desired =
      live === 0 ? DISCOVERY_INTERVAL_COLD_MS : DISCOVERY_INTERVAL_WARM_MS;
    if (desired !== this.currentPingIntervalMs) {
      this.currentPingIntervalMs = desired;
      try {
        // The library retriggers its internal timer when we call this again
        // with a different interval; safe to call on each transition.
        this.rexec.startSearchingForNodes(desired);
      } catch (err) {
        logAsyncFailure('UEPool.rexec.startSearchingForNodes', err);
      }
    }
  }

  /** Add a rexec event listener that won't crash the daemon on handler throws. */
  private addSafeListener(name: string, handler: RexecEventListener): void {
    this.rexec.events.addEventListener(name as never, (ev: unknown) => {
      try {
        handler(ev);
      } catch (err) {
        logAsyncFailure(`UEPool.listener[${name}]`, err);
      }
    });
  }

  private toSummary(n: RemoteExecutionNode): EditorSummary {
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

  /**
   * Live nodes only — filters out entries whose last pong is older than the
   * library's timeout window. The library only evicts on its own ping cycle,
   * so reading `remoteNodes` directly leaves ghost entries visible until that
   * sweep fires. Callers want a fresh view on read.
   */
  private freshNodes(now: number = Date.now()): RemoteExecutionNode[] {
    return this.rexec.remoteNodes.filter((n) => !n.shouldTimeout(now));
  }

  /** Resolve to a currently-live RemoteExecutionNode using the editor summary as the selection universe. */
  private resolveNodeLive(selector: string | undefined): RemoteExecutionNode {
    const liveNodes = this.freshNodes();
    const summaries = liveNodes.map((n) => this.toSummary(n));
    const chosen = resolveEditor(summaries, selector);
    const node = liveNodes.find((n) => n.nodeId === chosen.nodeId);
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

function logAsyncFailure(where: string, err: unknown): void {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`uemcp-daemon: async failure in ${where}: ${msg}\n`);
}
