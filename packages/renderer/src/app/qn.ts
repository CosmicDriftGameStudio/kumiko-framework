// Qualified-Name-Helper. Kumiko's Registry stempelt beim Boot den
// Feature-Prefix auf jede Screen/Nav/Workspace-id ein:
//
//   r.screen({ id: "task-list", ... })
//     → registry-stored.id === "tasks:screen:task-list"
//     → schema.screens (ans Browser) hat id === "tasks:screen:task-list"
//
// Der Renderer arbeitet aber mit Short-Form ids — formatPath schreibt
// sie 1:1 in die URL, parsePath liest sie 1:1 raus. Beim Übergang von
// Schema (QN-Form) → nav.navigate (Short-Form) muss der Prefix weg,
// sonst landet die URL doppelt-qualifiziert
// ("/tasks:screen:task-list" + Re-Lookup → "tasks:screen:tasks:screen:
// task-list" → 404).
//
// `lastSegment` ist die Inverse von qualifyScreenId/Nav/Workspace —
// nimmt den letzten ":"-getrennten Teil. Robust gegen Strings ohne
// ":" (returnt sie unverändert, damit App-Author-Code mit Short-Form-
// ids in eigenen Stellen weiter passt).

export function lastSegment(qn: string): string {
  const idx = qn.lastIndexOf(":");
  return idx < 0 ? qn : qn.slice(idx + 1);
}
