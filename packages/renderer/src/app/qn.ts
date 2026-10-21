// Qualified-name helper. At boot, Kumiko's Registry adds the feature prefix to every Screen/Nav/Workspace ID:
//
//   r.screen({ id: "task-list", ... })
//     → registry-stored.id === "tasks:screen:task-list"
//     → schema.screens (sent to the browser) has id === "tasks:screen:task-list"
//
// The renderer uses short-form IDs: formatPath writes them to the URL unchanged,
// and parsePath reads them back unchanged. When converting from the schema (QN form)
// to nav.navigate (short form), the prefix must be removed; otherwise the URL becomes
// doubly qualified
// ("/tasks:screen:task-list" + re-lookup → "tasks:screen:tasks:screen:
// task-list" → 404).
//
// `lastSegment` is the inverse of qualifyScreenId/Nav/Workspace: it takes the final
// ":"-separated part. Strings without ":" are returned unchanged so app-author code
// using short-form IDs continues to work.

export function lastSegment(qn: string): string {
  const idx = qn.lastIndexOf(":");
  return idx < 0 ? qn : qn.slice(idx + 1);
}

/**
 * Client-safe copy of framework `toKebab` (engine/qualified-name.ts).
 * Must stay in sync — do NOT import from `@cosmicdrift/kumiko-framework/engine`
 * here: that barrel pulls server deps into the browser bundle.
 */
export function toKebab(input: string): string {
  return input
    .replace(/\./g, "-")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}
