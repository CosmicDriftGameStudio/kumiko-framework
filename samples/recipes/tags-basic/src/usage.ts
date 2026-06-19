// kumiko-feature-version: 1
// Tags Basic — using the bundle.
//
// The tags feature is driven entirely by dispatching its handlers; nothing is
// wired into the tagged entity. A host needs exactly two calls — write and
// query — which any app dispatcher provides. This recipe's integration test
// runs `tagFlow` below against the real dispatcher + DB.

// The minimal surface the tag flow needs from a host dispatcher. An app's
// client satisfies this; the integration test adapts the test stack to it.
export type TagClient = {
  write: <T>(type: string, payload: unknown) => Promise<T>;
  query: <T>(type: string, payload: unknown) => Promise<T>;
};

// Create a tag, attach it to a note, read it from both directions, detach it.
export async function tagFlow(client: TagClient, noteId: string) {
  // 1. Create a tag in the tenant catalog → returns its id
  const { id: tagId } = await client.write<{ id: string }>("tags:write:create-tag", {
    name: "important",
  });

  // 2. Attach it to ANY entity by (type, id) — no column on that entity
  await client.write("tags:write:assign-tag", { tagId, entityType: "note", entityId: noteId });

  // 3a. "Which tags does this note have?" — filter assignments by entityId
  const ofNote = await client.query<{ rows: Array<{ tagId: string }> }>(
    "tags:query:tag-assignment:list",
    { filter: { field: "entityId", op: "eq", value: noteId } },
  );

  // 3b. "Which notes carry this tag?" — filter by tagId (no JOIN)
  const withTag = await client.query<{ rows: Array<{ entityId: string }> }>(
    "tags:query:tag-assignment:list",
    { filter: { field: "tagId", op: "eq", value: tagId } },
  );

  // 4. Detach it (idempotent — removing a missing link still succeeds)
  await client.write("tags:write:remove-tag", { tagId, entityType: "note", entityId: noteId });

  return {
    tagId,
    tagsOfNote: ofNote.rows.map((r) => r.tagId),
    notesWithTag: withTag.rows.map((r) => r.entityId),
  };
}
