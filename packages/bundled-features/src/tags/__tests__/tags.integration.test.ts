// Full-stack integration for the tags bundle. Drives create → assign → list →
// remove through the real dispatcher + entity-projection + DB. Proves the
// architecture end-to-end WITHOUT any host wiring (tags are host-agnostic — the
// host is just the entityType/entityId strings on the assignment):
//   - create-tag projects into read_tags
//   - assign-tag projects a join row keyed by (entityType, entityId)
//   - read-layer composition both directions (tags of an entity / entities of a tag)
//   - assign + remove are idempotent (re-assign = one row, remove-missing = ok)
//   - multi-tenant isolation

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { TagsHandlers, TagsQueries } from "../constants";
import { tagAssignmentEntity, tagEntity } from "../entity";
import { createTagsFeature } from "../feature";

const tagsFeature = createTagsFeature();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [tagsFeature] });
  await unsafeCreateEntityTable(stack.db, tagEntity);
  await unsafeCreateEntityTable(stack.db, tagAssignmentEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_tags");
  await asRawClient(stack.db).unsafe("DELETE FROM read_tag_assignments");
});

const admin = createTestUser({ roles: ["TenantAdmin"] });
const otherTenant = createTestUser({
  roles: ["TenantAdmin"],
  tenantId: "00000000-0000-4000-8000-0000000000aa",
});

async function createTag(name: string, user = admin): Promise<string> {
  const tag = await stack.http.writeOk<{ id: string }>(TagsHandlers.createTag, { name }, user);
  return tag.id;
}

async function assign(tagId: string, entityType: string, entityId: string, user = admin) {
  return stack.http.writeOk(TagsHandlers.assignTag, { tagId, entityType, entityId }, user);
}

async function remove(tagId: string, entityType: string, entityId: string, user = admin) {
  return stack.http.writeOk(TagsHandlers.removeTag, { tagId, entityType, entityId }, user);
}

async function deleteTag(id: string, user = admin) {
  return stack.http.writeOk(TagsHandlers.deleteTag, { id }, user);
}

async function tagById(id: string, user = admin): Promise<Record<string, unknown> | undefined> {
  return (await listTags(user)).find((t) => t["id"] === id);
}

async function listTags(user = admin): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    TagsQueries.tagList,
    {},
    user,
  );
  return res.rows;
}

async function listAssignments(
  filter: { field: string; op: "eq"; value: unknown } | undefined,
  user = admin,
): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    TagsQueries.assignmentList,
    filter ? { filter } : {},
    user,
  );
  return res.rows;
}

// Active assignments only — remove soft-deletes (the stream is kept so a
// re-assign can restore it), so isDeleted=true rows must not count as assigned.
async function countAssignments(tenantId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe(
    "SELECT count(*)::int AS n FROM read_tag_assignments WHERE tenant_id = $1 AND is_deleted = FALSE",
    [tenantId],
  );
  return (rows as ReadonlyArray<{ n: number }>)[0]?.n ?? 0;
}

describe("tags integration — catalog + assignment roundtrip", () => {
  test("create-tag lands in read_tags", async () => {
    const id = await createTag("Kunde Müller");
    const tags = await listTags();
    expect(tags).toHaveLength(1);
    expect(tags[0]?.["id"]).toBe(id);
    expect(tags[0]?.["name"]).toBe("Kunde Müller");
  });

  test("assign-tag → assignment queryable both composition directions", async () => {
    const tagId = await createTag("VIP");
    await assign(tagId, "credit", "credit-1");

    // tags of an entity
    const byEntity = await listAssignments({ field: "entityId", op: "eq", value: "credit-1" });
    expect(byEntity).toHaveLength(1);
    expect(byEntity[0]?.["tagId"]).toBe(tagId);
    expect(byEntity[0]?.["entityType"]).toBe("credit");

    // entities carrying a tag
    const byTag = await listAssignments({ field: "tagId", op: "eq", value: tagId });
    expect(byTag).toHaveLength(1);
    expect(byTag[0]?.["entityId"]).toBe("credit-1");
  });

  test("remove-tag deletes the assignment", async () => {
    const tagId = await createTag("temp");
    await assign(tagId, "credit", "credit-2");
    expect(await countAssignments(admin.tenantId)).toBe(1);

    await remove(tagId, "credit", "credit-2");
    expect(await countAssignments(admin.tenantId)).toBe(0);
    const left = await listAssignments({ field: "entityId", op: "eq", value: "credit-2" });
    expect(left).toHaveLength(0);
  });
});

describe("tags integration — rename", () => {
  test("rename-tag updates name, preserves color, bumps version", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      TagsHandlers.createTag,
      { name: "Mandant Alt", color: "#abc" },
      admin,
    );
    const before = await tagById(id);
    expect(before?.["name"]).toBe("Mandant Alt");
    // The rename UI passes the list-row version as the optimistic-lock base —
    // assert it's actually there (tags are CRUD-only, so it's authoritative).
    expect(typeof before?.["version"]).toBe("number");
    const version = before?.["version"] as number;

    await stack.http.writeOk(TagsHandlers.updateTag, { id, version, name: "Mandant Neu" }, admin);

    const after = await tagById(id);
    expect(after?.["name"]).toBe("Mandant Neu");
    expect(after?.["color"]).toBe("#abc"); // shallow merge keeps non-renamed fields
    expect(after?.["version"]).toBe(version + 1);
  });

  test("rename-tag with a stale version is rejected (409), name unchanged", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      TagsHandlers.createTag,
      { name: "Konflikt" },
      admin,
    );
    const stale = (await tagById(id))?.["version"] as number;
    await stack.http.writeOk(TagsHandlers.updateTag, { id, version: stale, name: "Erster" }, admin);

    const err = await stack.http.writeErr(
      TagsHandlers.updateTag,
      { id, version: stale, name: "Zweiter" }, // stale: the row already moved to stale+1
      admin,
    );
    expect(err.httpStatus).toBe(409);
    expect((await tagById(id))?.["name"]).toBe("Erster");
  });

  test("tenant B cannot rename tenant A's tag (404, A untouched)", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      TagsHandlers.createTag,
      { name: "A privat" },
      admin,
    );
    const version = (await tagById(id, admin))?.["version"] as number;

    const err = await stack.http.writeErr(
      TagsHandlers.updateTag,
      { id, version, name: "B-Übernahme" },
      otherTenant,
    );
    expect(err.httpStatus).toBe(404);
    expect((await tagById(id, admin))?.["name"]).toBe("A privat");
  });
});

describe("tags integration — update (recolor / re-scope)", () => {
  test("update-tag changes color + scope, preserves the untouched name", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      TagsHandlers.createTag,
      { name: "Projekt", color: "#111111" },
      admin,
    );
    const version = (await tagById(id))?.["version"] as number;
    await stack.http.writeOk(
      TagsHandlers.updateTag,
      { id, version, color: "#22cc88", scope: "note" },
      admin,
    );
    const after = await tagById(id);
    expect(after?.["name"]).toBe("Projekt");
    expect(after?.["color"]).toBe("#22cc88");
    expect(after?.["scope"]).toBe("note");
  });

  test("update-tag with empty color clears it", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      TagsHandlers.createTag,
      { name: "Farbe", color: "#abcdef" },
      admin,
    );
    const version = (await tagById(id))?.["version"] as number;
    await stack.http.writeOk(TagsHandlers.updateTag, { id, version, color: "" }, admin);
    expect((await tagById(id))?.["color"]).toBe("");
  });
});

describe("tags integration — delete-tag cascade", () => {
  test("deletes the tag and detaches it from every entity (multiple types)", async () => {
    const target = await createTag("Sammelmappe");
    const other = await createTag("bleibt");
    // target spans two entityTypes; other tag stays attached to prove scoping
    await assign(target, "credit", "credit-d1");
    await assign(target, "note", "note-d1");
    await assign(other, "credit", "credit-d1");
    expect(await countAssignments(admin.tenantId)).toBe(3);

    await deleteTag(target);

    expect(await tagById(target)).toBeUndefined();
    expect(await tagById(other)).toBeDefined();
    expect(await countAssignments(admin.tenantId)).toBe(1);
    expect(await listAssignments({ field: "tagId", op: "eq", value: target })).toHaveLength(0);
    expect(await listAssignments({ field: "tagId", op: "eq", value: other })).toHaveLength(1);
  });

  test("deleting an already-gone tag is idempotent success", async () => {
    const id = await createTag("einmalig");
    await deleteTag(id);
    await deleteTag(id); // second call must not error
    expect(await tagById(id)).toBeUndefined();
  });
});

describe("tags integration — many-to-many composition", () => {
  test("one entity carries multiple tags", async () => {
    const a = await createTag("rot");
    const b = await createTag("wasser");
    await assign(a, "credit", "credit-3");
    await assign(b, "credit", "credit-3");

    const tags = await listAssignments({ field: "entityId", op: "eq", value: "credit-3" });
    expect(tags.map((r) => r["tagId"]).sort()).toEqual([a, b].sort());
  });

  test("one tag spans multiple entities", async () => {
    const tagId = await createTag("Mappe-2026");
    await assign(tagId, "credit", "credit-4");
    await assign(tagId, "credit", "credit-5");

    const entities = await listAssignments({ field: "tagId", op: "eq", value: tagId });
    expect(entities.map((r) => r["entityId"]).sort()).toEqual(["credit-4", "credit-5"]);
  });
});

describe("tags integration — idempotency", () => {
  test("re-assigning the same (tag, entity) keeps exactly one row", async () => {
    const tagId = await createTag("dup");
    await assign(tagId, "credit", "credit-6");
    await assign(tagId, "credit", "credit-6"); // re-assign: must be a no-op success

    expect(await countAssignments(admin.tenantId)).toBe(1);
    const rows = await listAssignments({ field: "entityId", op: "eq", value: "credit-6" });
    expect(rows).toHaveLength(1);
  });

  test("removing a never-assigned (tag, entity) succeeds (no error, no row)", async () => {
    const tagId = await createTag("ghost");
    // never assigned — remove must still succeed (idempotent end-state)
    await remove(tagId, "credit", "credit-7");
    expect(await countAssignments(admin.tenantId)).toBe(0);
  });

  test("assign → remove → assign-again resurrects the same deterministic stream", async () => {
    const tagId = await createTag("recurring");
    await assign(tagId, "credit", "credit-r");
    await remove(tagId, "credit", "credit-r");
    expect(await countAssignments(admin.tenantId)).toBe(0);

    // Re-attaching the same (tag, entity) must succeed (restore), not 409 — the
    // deterministic aggregate-id reuses the removed stream.
    await assign(tagId, "credit", "credit-r");
    expect(await countAssignments(admin.tenantId)).toBe(1);
    const rows = await listAssignments({ field: "entityId", op: "eq", value: "credit-r" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tagId"]).toBe(tagId);
  });

  test("two concurrent first-time assigns of the same (tag, entity) both succeed — one row", async () => {
    // Both requests read `existing === null` before either write lands, so
    // both fall through to create(); the loser's create() version_conflicts.
    // The handler must converge that into success instead of surfacing a 409
    // for what is, from the caller's perspective, an idempotent operation.
    const tagId = await createTag("racy");
    const [a, b] = await Promise.all([
      assign(tagId, "credit", "credit-race"),
      assign(tagId, "credit", "credit-race"),
    ]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(await countAssignments(admin.tenantId)).toBe(1);
  });
});

describe("tags integration — referential integrity", () => {
  test("assigning an unknown tagId is rejected (no dangling assignment)", async () => {
    const err = await stack.http.writeErr(
      TagsHandlers.assignTag,
      { tagId: "00000000-0000-4000-8000-00000000dead", entityType: "credit", entityId: "credit-x" },
      admin,
    );
    expect(err.httpStatus).toBe(404);
    expect(await countAssignments(admin.tenantId)).toBe(0);
  });
});

describe("tags integration — multi-tenant isolation", () => {
  test("tenant B sees neither tenant A's tags nor assignments", async () => {
    const tagId = await createTag("A-only", admin);
    await assign(tagId, "credit", "credit-8", admin);

    expect(await listTags(otherTenant)).toHaveLength(0);
    expect(
      await listAssignments({ field: "entityId", op: "eq", value: "credit-8" }, otherTenant),
    ).toHaveLength(0);

    // tenant A still sees its own
    expect(await listTags(admin)).toHaveLength(1);
    expect(await countAssignments(admin.tenantId)).toBe(1);
    expect(await countAssignments(otherTenant.tenantId)).toBe(0);
  });
});

// The access option must reach the runtime, not just the handler shape: a host
// that mounts tags with openToAll lets a user WITHOUT any default tag role tag
// freely (the exact failure that bit money-horse, whose signup users carry
// "Admin", not "TenantAdmin"). Default-mounted tags deny that same user.
describe("tags integration — openToAll access model", () => {
  let openStack: TestStack;
  // Dedicated stack (477/1), not the outer file's `stack` — a describe-level
  // `--test-name-pattern` run of just this block would otherwise crash on an
  // undefined outer `stack` instead of failing cleanly, and this block
  // shouldn't depend on describe-execution order for its setup to exist.
  let defaultStack: TestStack;
  // role deliberately not in DEFAULT_TAG_ROLES nor "Admin" — proves openToAll,
  // not an accidental role match.
  const unprivileged = createTestUser({ roles: ["Viewer"] });

  beforeAll(async () => {
    openStack = await setupTestStack({
      features: [createTagsFeature({ access: { openToAll: true } })],
    });
    await unsafeCreateEntityTable(openStack.db, tagEntity);
    await unsafeCreateEntityTable(openStack.db, tagAssignmentEntity);
    await createEventsTable(openStack.db);

    defaultStack = await setupTestStack({ features: [tagsFeature] });
    await unsafeCreateEntityTable(defaultStack.db, tagEntity);
    await unsafeCreateEntityTable(defaultStack.db, tagAssignmentEntity);
    await createEventsTable(defaultStack.db);
  });

  afterAll(async () => {
    await openStack.cleanup();
    await defaultStack.cleanup();
  });

  test("a non-tag-role user can create, assign, list and remove", async () => {
    const tag = await openStack.http.writeOk<{ id: string }>(
      TagsHandlers.createTag,
      { name: "Paket A" },
      unprivileged,
    );
    await openStack.http.writeOk(
      TagsHandlers.assignTag,
      { tagId: tag.id, entityType: "credit", entityId: "c-1" },
      unprivileged,
    );

    const tags = await openStack.http.queryOk<{ rows: unknown[] }>(
      TagsQueries.tagList,
      {},
      unprivileged,
    );
    expect(tags.rows).toHaveLength(1);

    const assigned = await openStack.http.queryOk<{ rows: unknown[] }>(
      TagsQueries.assignmentList,
      { filter: { field: "entityId", op: "eq", value: "c-1" } },
      unprivileged,
    );
    expect(assigned.rows).toHaveLength(1);

    await openStack.http.writeOk(
      TagsHandlers.removeTag,
      { tagId: tag.id, entityType: "credit", entityId: "c-1" },
      unprivileged,
    );
  });

  test("the SAME user is denied on a default-role-mounted feature", async () => {
    const denied = await defaultStack.http.writeErr(
      TagsHandlers.createTag,
      { name: "nope" },
      unprivileged,
    );
    expect(denied.httpStatus).toBe(403);
  });
});
