// fw#2627 — add-note previously trusted entityType/entityId straight from the
// client, so any dispatch-eligible tenant user could attach a note to a
// parent object they had no read access to. The parent-visibility check is
// unconditional (default-on, no opt-in): entityType must name a registered
// entity, and the row must be visible through that entity's own read path
// (tenant scope plus its `access.read` ownership) before add-note accepts
// the write — on every mount, `parents` or not. `parents`, when set, only
// narrows FURTHER to an allowlist of permitted parent entity names; it is
// not what turns the check on (see `openStack` tests below, which mount
// notes-history with no `parents` at all and still enforce the check).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { NotesHistoryHandlers } from "../constants";
import { createNoteEntryEntity, noteMentionEntity } from "../entity";
import { createNotesHistoryFeature } from "../feature";

const PROJECT_TABLE = "notes_pv_test_projects";

// Team-scoped read ownership on the parent entity itself — the caller sees a
// project row only if their `team` claim matches the row's team_id.
const projectOwnership: NonNullable<EntityDefinition["access"]> = {
  read: {
    TenantMember: {
      kind: "where",
      where: (user, ctx) => ({
        sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
        params: [user.claims?.["team"] ?? null],
      }),
    },
  },
};

function createProjectEntity(access?: EntityDefinition["access"]): EntityDefinition {
  return createEntity({
    table: PROJECT_TABLE,
    fields: {
      teamId: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      name: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
    },
    access,
  });
}

const guardedProjectEntity = createProjectEntity(projectOwnership);

// A second registered entity, deliberately left OUT of the `parents`
// allowlist below — proves the allowlist rejects a real, registered entity
// too, not just made-up names.
const contactEntity = createEntity({
  table: "notes_pv_test_contacts",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

const fixturesFeature = defineFeature("notes-pv-test-fixtures", (r) => {
  r.entity("project", guardedProjectEntity);
  r.entity("contact", contactEntity);
});

type TestUser = ReturnType<typeof createTestUser>;

// Same tenant, different team claim — mirrors the ownership integration test.
const userA: TestUser = createTestUser({
  id: 40,
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});
const userB: TestUser = createTestUser({
  id: 41,
  roles: ["TenantMember"],
  claims: { team: "team-b" },
});

const PROJECT_A = "a0000000-0000-4000-8000-000000000001";
// A second team-a project, dedicated to the cross-team-denial case so its
// note-count stays independent of PROJECT_A's.
const PROJECT_A2 = "a0000000-0000-4000-8000-000000000002";
// openStack-only team-a project row — never reused as PROJECT_A2 so the two
// stacks' tests stay order-independent.
const PROJECT_OPEN = "a0000000-0000-4000-8000-000000000009";

let guardedStack: TestStack;
let openStack: TestStack;

beforeAll(async () => {
  guardedStack = await setupTestStack({
    features: [createNotesHistoryFeature({ parents: ["project"] }), fixturesFeature],
  });
  await unsafeCreateEntityTable(guardedStack.db, guardedProjectEntity);
  await unsafeCreateEntityTable(guardedStack.db, createNoteEntryEntity());
  await unsafeCreateEntityTable(guardedStack.db, noteMentionEntity);
  await createEventsTable(guardedStack.db);
  await asRawClient(guardedStack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES
       ($1, $2, 'team-a', 'Project A'),
       ($3, $2, 'team-a', 'Project A2')`,
    [PROJECT_A, userA.tenantId, PROJECT_A2],
  );

  // Unguarded mount: the SAME feature with no `parents` at all — proves the
  // parent-visibility check itself is default-on, not something `parents`
  // switches on.
  openStack = await setupTestStack({
    features: [createNotesHistoryFeature(), fixturesFeature],
  });
  await unsafeCreateEntityTable(openStack.db, guardedProjectEntity);
  await unsafeCreateEntityTable(openStack.db, createNoteEntryEntity());
  await unsafeCreateEntityTable(openStack.db, noteMentionEntity);
  await createEventsTable(openStack.db);
  await asRawClient(openStack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES ($1, $2, 'team-a', 'Project Open')`,
    [PROJECT_OPEN, userA.tenantId],
  );
});

afterAll(async () => {
  await guardedStack.cleanup();
  await openStack.cleanup();
});

async function addNote(
  stack: TestStack,
  entityType: string,
  entityId: string,
  user: TestUser,
): Promise<{ id: string }> {
  return stack.http.writeOk<{ id: string }>(
    NotesHistoryHandlers.addNote,
    { entityType, entityId, body: "note" },
    user,
  );
}

async function addNoteErr(stack: TestStack, entityType: string, entityId: string, user: TestUser) {
  return stack.http.writeErr(
    NotesHistoryHandlers.addNote,
    { entityType, entityId, body: "note" },
    user,
  );
}

async function noteCountFor(stack: TestStack, entityId: string): Promise<number> {
  const rows = await asRawClient(stack.db).unsafe<{ count: string }>(
    `SELECT count(*)::text AS count FROM read_note_entries WHERE entity_id = $1`,
    [entityId],
  );
  return Number(rows[0]?.count ?? "0");
}

describe("notes-history integration — add-note parent-visibility (parents option)", () => {
  test("caller may note a parent row visible through the parent entity's own read path", async () => {
    const result = await addNote(guardedStack, "project", PROJECT_A, userA);
    expect(result.id).toBeTruthy();
    expect(await noteCountFor(guardedStack, PROJECT_A)).toBe(1);
  });

  test("caller is denied noting a parent row from a foreign team while the same row is writable by its own team", async () => {
    const err = await addNoteErr(guardedStack, "project", PROJECT_A2, userB);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
    expect(await noteCountFor(guardedStack, PROJECT_A2)).toBe(0);

    // Positive control: PROJECT_A2 itself is writable — by its own team — so
    // the deny above is the team-claim check, not some other rejection (e.g.
    // a row that doesn't exist at all).
    const result = await addNote(guardedStack, "project", PROJECT_A2, userA);
    expect(result.id).toBeTruthy();
    expect(await noteCountFor(guardedStack, PROJECT_A2)).toBe(1);
  });

  test("entityType outside the allowlist is denied even when it is a registered entity", async () => {
    const err = await addNoteErr(
      guardedStack,
      "contact",
      "c0000000-0000-4000-8000-000000000003",
      userA,
    );
    expect(err.code).toBe("not_found");
  });

  test("entityType that is not registered anywhere is denied", async () => {
    const err = await addNoteErr(guardedStack, "totally-unknown-entity", "x", userA);
    expect(err.code).toBe("not_found");
  });

  test("a malformed entityId is denied cleanly, without poisoning the connection for later writes", async () => {
    const err = await addNoteErr(guardedStack, "project", "not-a-uuid", userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);

    // The stack must still be usable afterwards — proves the malformed id was
    // rejected before it ever reached a query, not caught after a failed
    // (and tx-poisoning) cast.
    const result = await addNote(guardedStack, "project", PROJECT_A, userA);
    expect(result.id).toBeTruthy();
  });

  test("on an unguarded mount (no `parents`), an unregistered entityType is still denied — the check is default-on", async () => {
    const err = await addNoteErr(openStack, "totally-unknown-entity", "y", userA);
    expect(err.code).toBe("not_found");
  });

  test("on an unguarded mount, a registered and visible parent still succeeds", async () => {
    const result = await addNote(openStack, "project", PROJECT_OPEN, userA);
    expect(result.id).toBeTruthy();
    expect(await noteCountFor(openStack, PROJECT_OPEN)).toBe(1);
  });

  test("on an unguarded mount, a registered parent from a foreign team is still denied", async () => {
    const err = await addNoteErr(openStack, "project", PROJECT_OPEN, userB);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });
});
