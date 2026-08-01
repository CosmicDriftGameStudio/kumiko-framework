// Notes History Basic — using the bundle.
//
// The notes-history feature is driven entirely by dispatching its handlers;
// nothing is wired into the noted entity. A host needs exactly two calls —
// write and query — which any app dispatcher provides. This recipe's
// integration test runs `notesFlow` below against the real dispatcher + DB.

// The minimal surface the notes flow needs from a host dispatcher. An app's
// client satisfies this; the integration test adapts the test stack to it.
export type NotesClient = {
  write: <T>(type: string, payload: unknown) => Promise<T>;
  query: <T>(type: string, payload: unknown) => Promise<T>;
};

// Append two notes to a task, then read its history back.
export async function notesFlow(client: NotesClient, taskId: string) {
  // 1. Append a note to ANY entity by (type, id) — no column on that entity.
  //    The author is never passed in: the server always attributes the note
  //    to the authenticated caller.
  await client.write("notes-history:write:add-note", {
    entityType: "task",
    entityId: taskId,
    body: "Kick-off call scheduled for Monday.",
  });
  await client.write("notes-history:write:add-note", {
    entityType: "task",
    entityId: taskId,
    body: "Client confirmed the scope.",
  });

  // 2. "What notes does this task have?" — filter note-entry by entityId,
  //    newest first.
  const history = await client.query<{
    rows: Array<{ body: string; authorId: string; insertedAt: string }>;
  }>("notes-history:query:note-entry:list", {
    filter: { field: "entityId", op: "eq", value: taskId },
    sort: "insertedAt",
    sortDirection: "desc",
  });

  return { entries: history.rows };
}
