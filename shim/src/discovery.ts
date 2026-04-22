// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Watches the shared discovery directory for per-PID JSON files written by
// each running UEMCP plugin instance and maintains an in-memory registry of
// live editors. Stale files (PID no longer alive) are filtered on read.

import chokidar, { type FSWatcher } from 'chokidar';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface DiscoveredEditor {
  protocol_version: string;
  pid: number;
  project_name: string;
  project_path: string;
  engine_version: string;
  map?: string;
  host: string;
  port: number;
  started_at: string;
  /** Absolute path of the discovery file this record was loaded from. */
  source_file: string;
}

export class Discovery {
  private readonly editors = new Map<string, DiscoveredEditor>();
  private watcher?: FSWatcher;

  constructor(private readonly dir: string) {}

  async start(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
    } catch {
      // dir may already exist; chokidar handles that
    }

    try {
      const files = await readdir(this.dir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          await this.load(join(this.dir, f));
        }
      }
    } catch {
      // dir may have been removed between mkdir and readdir; ignore
    }

    this.watcher = chokidar.watch(this.dir, {
      ignoreInitial: true,
      persistent: true,
    });
    this.watcher.on('add', (p: string) => {
      void this.load(p);
    });
    this.watcher.on('change', (p: string) => {
      void this.load(p);
    });
    this.watcher.on('unlink', (p: string) => {
      this.editors.delete(p);
    });
  }

  private async load(path: string): Promise<void> {
    if (!path.endsWith('.json')) return;
    try {
      const content = await readFile(path, 'utf8');
      const parsed = JSON.parse(content) as Partial<DiscoveredEditor>;
      if (
        typeof parsed.pid !== 'number' ||
        typeof parsed.project_name !== 'string'
      ) {
        return; // malformed; skip
      }
      const entry: DiscoveredEditor = {
        protocol_version: parsed.protocol_version ?? 'unknown',
        pid: parsed.pid,
        project_name: parsed.project_name,
        project_path: parsed.project_path ?? '',
        engine_version: parsed.engine_version ?? '',
        map: parsed.map,
        host: parsed.host ?? '127.0.0.1',
        port: parsed.port ?? 0,
        started_at: parsed.started_at ?? '',
        source_file: path,
      };
      this.editors.set(path, entry);
    } catch {
      // malformed JSON or a partial write; skip, next event will retry
    }
  }

  /** Currently known editors, with dead PIDs filtered out. */
  getEditors(): DiscoveredEditor[] {
    return Array.from(this.editors.values()).filter((e) => isPidAlive(e.pid));
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.editors.clear();
  }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // signal 0: existence check, no actual signal sent. Works on Windows too.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we don't have permission to signal it.
    return code === 'EPERM';
  }
}
