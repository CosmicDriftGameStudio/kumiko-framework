// @runtime client
// Pure tree helpers shared by FolderManager (nested render) and FolderSection
// (path-labelled options). No React, no IO — folder rows in, structure out, so
// both can be unit-tested without a renderer harness.

export type FolderRow = {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly version: number;
};

export type FolderNode = FolderRow & {
  readonly children: readonly FolderNode[];
  readonly depth: number;
};

function byName(a: FolderRow, b: FolderRow): number {
  return a.name.localeCompare(b.name);
}

// Roots (parentId null OR pointing at a row that no longer exists — a dangling
// parentId from a deleted parent stays visible at the top instead of vanishing)
// with children attached recursively, each level sorted by name.
export function buildFolderTree(rows: readonly FolderRow[]): readonly FolderNode[] {
  const byParent = new Map<string | null, FolderRow[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const row of rows) {
    const key = row.parentId !== null && ids.has(row.parentId) ? row.parentId : null;
    const siblings = byParent.get(key);
    if (siblings) siblings.push(row);
    else byParent.set(key, [row]);
  }
  const build = (parentId: string | null, depth: number): readonly FolderNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort(byName)
      .map((row) => ({ ...row, depth, children: build(row.id, depth + 1) }));
  return build(null, 0);
}

// "Immobilie Berlin / Person Müller" for a folder id, walking parentId up.
// Empty string if the id is unknown. The row-count cap stops a (currently
// impossible — no reparent yet) parent cycle from spinning forever.
export function folderPath(rows: readonly FolderRow[], id: string, separator = " / "): string {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const names: string[] = [];
  let current = byId.get(id);
  for (let i = 0; current !== undefined && i <= rows.length; i += 1) {
    names.unshift(current.name);
    current = current.parentId !== null ? byId.get(current.parentId) : undefined;
  }
  return names.join(separator);
}
