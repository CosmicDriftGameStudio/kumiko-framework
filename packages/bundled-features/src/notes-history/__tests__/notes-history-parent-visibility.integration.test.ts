// add-note previously trusted entityType/entityId straight from the
// client, so any dispatch-eligible tenant user could attach a note to a
// parent object they had no read access to. The parent-visibility check is
// unconditional (default-on, no opt-in): entityType must name a registered
// entity, and the row must be visible through that entity's own read path
// (tenant scope plus its `access.read` ownership) before add-note accepts
// the write — on every mount, `parents` or not. `parents`, when set, only
// narrows FURTHER to an allowlist of permitted parent entity names; it is
// not what turns the check on.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient, buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { z } from "zod";
import { createNoteEntryEntity, noteMentionEntity } from "../entity.ts";
import { createNotesHistoryFeature } from "../feature.ts";
import { NotesHistoryHandlers, NotesHistoryQueries } from "../web/constants.ts";

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
    name: "project",
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
  name: "contact",
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

// Host with a query handler restricted to TenantAdmin: its row rules admit every
// member, so only the handler roles keep TenantMember away from its join rows.
const budgetEntity = createEntity({
  name: "budget",
  table: "notes_pv_test_budgets",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

// Integer-id host: exercises the `idType: "serial"` branch of the id-shape gate
// (rejects before any query, so no table is needed).
const ticketEntity = createEntity({
  name: "ticket",
  table: "notes_pv_test_tickets",
  idType: "serial",
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
  r.entity(guardedProjectEntity);
  r.entity(contactEntity);
  r.entity(ticketEntity);
  r.entity(budgetEntity);
  r.queryHandler({
    name: "budget:list",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ rows: [], nextCursor: null }),
  });
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

const adminUser: TestUser = createTestUser({
  id: 43,
  roles: ["TenantAdmin", "TenantMember"],
});

const userOtherTenant: TestUser = createTestUser({
  id: 42,
  tenantId: testTenantId(4242),
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});

const PROJECT_A = "a0000000-0000-4000-8000-000000000001";
// A second team-a project, dedicated to the cross-team-denial case so its
// note-count stays independent of PROJECT_A's.
const PROJECT_A2 = "a0000000-0000-4000-8000-000000000002";
// openStack-only team-a project row — never reused as PROJECT_A2 so the two
// stacks' tests stay order-independent.
const PROJECT_OPEN = "a0000000-0000-4000-8000-000000000009";
const BUDGET_ID = "b0000000-0000-4000-8000-000000000001";

let guardedStack: TestStack;
let openStack: TestStack;

beforeAll(async () => {
  guardedStack = await setupTestStack({
    features: [createNotesHistoryFeature({ parents: ["project"] }), fixturesFeature],
  });
  await unsafeCreateEntityTable(guardedStack.db, guardedProjectEntity);
  await unsafeCreateEntityTable(guardedStack.db, createNoteEntryEntity(undefined, ["project"]));
  await unsafeCreateEntityTable(guardedStack.db, noteMentionEntity);
  await asRawClient(guardedStack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES
       ($1, $2, 'team-a', 'Project A'),
       ($3, $2, 'team-a', 'Project A2')`,
    [PROJECT_A, userA.tenantId, PROJECT_A2],
  );

  // Wider mount: the same feature listing every fixture host — proves the
  // parent-visibility check still runs per host, not only on a narrow allowlist.
  openStack = await setupTestStack({
    features: [
      createNotesHistoryFeature({ parents: ["project", "contact", "ticket", "budget"] }),
      fixturesFeature,
    ],
  });
  await unsafeCreateEntityTable(openStack.db, guardedProjectEntity);
  await unsafeCreateEntityTable(
    openStack.db,
    createNoteEntryEntity(undefined, ["project", "contact", "ticket", "budget"]),
  );
  await unsafeCreateEntityTable(openStack.db, noteMentionEntity);
  await asRawClient(openStack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id, name) VALUES ($1, $2, 'team-a', 'Project Open')`,
    [PROJECT_OPEN, userA.tenantId],
  );
  await unsafeCreateEntityTable(openStack.db, budgetEntity);
  await seedRowViaEventStore(openStack.db, buildEntityTable(budgetEntity), {
    id: BUDGET_ID,
    tenantId: userA.tenantId,
    name: "Budget",
  });
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

  test("on a wide mount, an unregistered entityType is still denied", async () => {
    const err = await addNoteErr(openStack, "totally-unknown-entity", "y", userA);
    expect(err.code).toBe("not_found");
  });

  test("on a wide mount, a registered and visible parent still succeeds", async () => {
    const result = await addNote(openStack, "project", PROJECT_OPEN, userA);
    expect(result.id).toBeTruthy();
    expect(await noteCountFor(openStack, PROJECT_OPEN)).toBe(1);
  });

  test("on a wide mount, a registered parent from a foreign team is still denied", async () => {
    const err = await addNoteErr(openStack, "project", PROJECT_OPEN, userB);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });

  test("serial host: non-numeric and int4-overflowing ids are denied cleanly before reaching the executor", async () => {
    for (const badId of ["abc", "99999999999", "9223372036854775808", "2147483648"]) {
      const err = await addNoteErr(openStack, "ticket", badId, userA);
      expect(err.code).toBe("not_found");
      expect(err.httpStatus).toBe(404);
    }
    // Connection stays usable: no 22003 poisoned the transaction.
    const result = await addNote(openStack, "project", PROJECT_OPEN, userA);
    expect(result.id).toBeTruthy();
  });

  test("a user from another tenant cannot note a host row of the first tenant", async () => {
    const err = await addNoteErr(openStack, "project", PROJECT_OPEN, userOtherTenant);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });

  test("a role without access to the host's query handlers cannot note it, although its row rules would allow it", async () => {
    const err = await addNoteErr(openStack, "budget", BUDGET_ID, userA);
    expect(err.code).toBe("not_found");
    expect(err.httpStatus).toBe(404);
  });

  test("a role the host's query handler admits may note it", async () => {
    const result = await addNote(openStack, "budget", BUDGET_ID, adminUser);
    expect(result.id).toBeTruthy();
  });

  test("notes on a host stay hidden from a role without access to the host's query handlers", async () => {
    await addNote(openStack, "budget", BUDGET_ID, adminUser);
    const asAdmin = await openStack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      NotesHistoryQueries.noteList,
      {},
      adminUser,
    );
    expect(asAdmin.rows.some((row) => row["entityId"] === BUDGET_ID)).toBe(true);

    const asMember = await openStack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
      NotesHistoryQueries.noteList,
      {},
      userA,
    );
    expect(asMember.rows.some((row) => row["entityId"] === BUDGET_ID)).toBe(false);
  });
});
