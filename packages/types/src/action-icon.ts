import type { IconKey } from "./nav-icon";

// Part B (fw-ui-defaults): id-derived default icon for actions that never
// declared one — a screen author still gets a recognizable glyph instead of
// a bare label. Checked against the actually registered IconKey vocabulary
// (nav-icon.ts) — no entry for verbs without a matching icon (e.g. "start",
// "pause").
export const ACTION_ICON_BY_ID: Readonly<Partial<Record<string, IconKey>>> = {
  delete: "trash",
  deletion: "trash",
  edit: "pencil",
  create: "plus",
  new: "plus",
  add: "plus",
  view: "eye",
  open: "eye",
  cancel: "x",
  reject: "x",
  complete: "check",
  resolve: "check",
  approve: "check",
  archive: "archive",
  publish: "upload",
  duplicate: "copy",
  copy: "copy",
  download: "download",
  refresh: "refresh",
  retry: "refresh",
  settings: "settings",
  share: "share",
  send: "send",
};

// Ids are kebab-case (RowAction.id doc): aggregate-object-verb
// ("order-ship") or verb-prefix ("add-item").
function kebabLastSegment(id: string): string {
  const idx = id.lastIndexOf("-");
  return idx === -1 ? id : id.slice(idx + 1);
}

function kebabFirstSegment(id: string): string {
  const idx = id.indexOf("-");
  return idx === -1 ? id : id.slice(0, idx);
}

// Resolution order: author-declared `icon` wins, then the id-derived
// default (full id, then its last kebab segment, then its first kebab
// segment). `declared` is `undefined` for ToolbarAction, which has no
// author-facing icon field.
export function resolveActionIcon(id: string, declared?: IconKey): IconKey | undefined {
  if (declared !== undefined) return declared;
  return (
    ACTION_ICON_BY_ID[id] ??
    ACTION_ICON_BY_ID[kebabLastSegment(id)] ??
    ACTION_ICON_BY_ID[kebabFirstSegment(id)]
  );
}
