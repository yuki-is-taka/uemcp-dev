// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Fuzzy resolution of a user-provided editor selector against the current
// list of listening editors.

import type { DiscoveredEditor } from './discovery.js';

export function resolveEditor(
  all: DiscoveredEditor[],
  selector: string | undefined,
): DiscoveredEditor {
  const listening = all.filter((e) => e.port > 0);

  if (listening.length === 0) {
    throw new Error(
      'No UE editor is currently listening for MCP. Make sure the UEMCP plugin is loaded and its TCP server has finished starting up.',
    );
  }

  if (selector === undefined || selector === '') {
    if (listening.length === 1) {
      return listening[0]!;
    }
    const names = listening.map((e) => e.project_name).join(', ');
    throw new Error(
      `${listening.length} UE editors are listening. Provide an 'editor' argument to pick one. Candidates: ${names}`,
    );
  }

  const lower = selector.toLowerCase();

  const exact = listening.find((e) => e.project_name.toLowerCase() === lower);
  if (exact) return exact;

  const byPid = listening.find((e) => String(e.pid) === selector);
  if (byPid) return byPid;

  const subs = listening.filter(
    (e) =>
      e.project_name.toLowerCase().includes(lower) ||
      e.project_path.toLowerCase().includes(lower),
  );
  if (subs.length === 1) return subs[0]!;
  if (subs.length > 1) {
    const names = subs.map((e) => e.project_name).join(', ');
    throw new Error(`Selector "${selector}" matches multiple editors: ${names}`);
  }

  const available = listening.map((e) => e.project_name).join(', ');
  throw new Error(`No editor matches "${selector}". Available: ${available}`);
}
