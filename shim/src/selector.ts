// Copyright (c) 2026 yuki-is-taka. Licensed under the MIT License.
//
// Fuzzy resolution of a user-provided editor selector against the current
// list of discovered editors.

export interface EditorSummaryLite {
  project_name: string;
  project_path: string;
  nodeId: string;
}

export function resolveEditor<E extends EditorSummaryLite>(
  all: E[],
  selector: string | undefined,
): E {
  if (all.length === 0) {
    throw new Error(
      'No UE editor discovered yet. Make sure the editor is running with Python Remote Execution enabled (Project Settings → Plugins → Python → "Remote Execution").',
    );
  }

  if (selector === undefined || selector === '') {
    if (all.length === 1) return all[0]!;
    const names = all.map((e) => e.project_name).join(', ');
    throw new Error(
      `${all.length} UE editors discovered. Specify 'editor' argument. Candidates: ${names}`,
    );
  }

  const lower = selector.toLowerCase();

  const exact = all.find((e) => e.project_name.toLowerCase() === lower);
  if (exact) return exact;

  const subs = all.filter(
    (e) =>
      e.project_name.toLowerCase().includes(lower) ||
      e.project_path.toLowerCase().includes(lower),
  );
  if (subs.length === 1) return subs[0]!;
  if (subs.length > 1) {
    const names = subs.map((e) => e.project_name).join(', ');
    throw new Error(`Selector "${selector}" matches multiple editors: ${names}`);
  }

  const available = all.map((e) => e.project_name).join(', ');
  throw new Error(`No editor matches "${selector}". Available: ${available}`);
}
