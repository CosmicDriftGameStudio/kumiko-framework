// H.2 — row-level READ ownership for note-entry. Before this fix,
// noteEntryEntity had no `access`, so buildOwnershipClause always returned
// PASS_CLAUSE and any dispatch-eligible user could list every note in the
// tenant, including notes on host entities they can't otherwise see.
//
// This is also the framework's first production exercise of a `where`-rule
// WITH A SUBQUERY (existing ownership tests only use a literal
// `sqlText: "custom_expr_42 = 1"`), so the scenario is built to genuinely
// stress shiftParams: the ownership fragment's `$N` placeholder must be
// renumbered past the tenant-scope filter's already-consumed slots
// (event-store-executor-read.ts), not just happen to work at `$1`.
//
// fw#2627 made add-note's parent-visibility check unconditional: entityType
// must now name a registered entity, and the row must exist and be visible
// to the caller. This file tests NOTE-level ownership, not parent-level, so
// the fixture `project` entity below is deliberately registered with NO
// `access` (PASS_CLAUSE) — any tenant member can write a note onto it — and
// every project row used below is inserted before its add-note call, so the
// parent-visibility check never interferes with what this file is actually
// proving.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
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
import { NotesHistoryHandlers, NotesHistoryQueries } from "../constants";
import { createNoteEntryEntity, noteEntryEntity } from "../entity";
import { createNotesHistoryFeature } from "../feature";

// Minimal fixture standing in for a real host projection: which team a host
// entity (identified by entityId) belongs to. A real feature would source
// this from its own read-model — this table exists only to give the
// where-rule's subquery something real to join against.
const TEAMS_TABLE = "notes_ownership_test_teams";

const teamOwnership: NonNullable<EntityDefinition["access"]> = {
  read: {
    TenantMember: {
      kind: "where",
      where: (user, ctx) => ({
        // Qualify the outer reference with ctx.tableName — the subquery's own
        // `t.entity_id` column would otherwise shadow an unqualified bare
        // `entity_id`, since Postgres resolves unqualified names to the
        // innermost scope first. Confirmed by a raw-SQL repro during test
        // development: an unqualified reference silently turned this into a
        // self-join tautology (`t.entity_id = t.entity_id`), matching every
        // row regardless of team.
        sqlText: `EXISTS (SELECT 1 FROM ${TEAMS_TABLE} t WHERE t.entity_id = ${ctx.tableName}.entity_id AND t.team_id = $${ctx.paramStart})`,
        params: [user.claims?.["team"] ?? null],
      }),
    },
  },
};

// The `project` parent entity add-note now always checks for. No `access` —
// PASS_CLAUSE — so it never gates on its own; this file's team split is
// entirely on the note-entry side (teamOwnership above).
const PROJECT_TABLE = "notes_ownership_test_projects";
const projectEntity: EntityDefinition = createEntity({
  table: PROJECT_TABLE,
  fields: { name: createTextField({ required: true, maxLength: 64 }) },
});
const projectFixtureFeature = defineFeature("notes-ownership-test-project-fixture", (r) => {
  r.entity("project", projectEntity);
});

const PROJ_1 = "20000000-0000-4000-8000-000000000001";
const PROJ_9 = "20000000-0000-4000-8000-000000000009";
const PROJ_2 = "20000000-0000-4000-8000-000000000002";

type TestUser = ReturnType<typeof createTestUser>;

let scopedStack: TestStack;
let defaultStack: TestStack;

// Same tenant, different team claim — the ownership rule (not tenant
// scoping) is what must separate them.
const userA: TestUser = createTestUser({
  id: 20,
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});
const userB: TestUser = createTestUser({
  id: 21,
  roles: ["TenantMember"],
  claims: { team: "team-b" },
});

async function insertProjects(
  stack: TestStack,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  for (const id of ids) {
    await asRawClient(stack.db).unsafe(
      `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, name) VALUES ($1, $2, $3)`,
      [id, tenantId, id],
    );
  }
}

beforeAll(async () => {
  scopedStack = await setupTestStack({
    features: [createNotesHistoryFeature({ ownership: teamOwnership }), projectFixtureFeature],
  });
  await unsafeCreateEntityTable(scopedStack.db, createNoteEntryEntity(teamOwnership));
  await unsafeCreateEntityTable(scopedStack.db, projectEntity);
  await createEventsTable(scopedStack.db);
  await asRawClient(scopedStack.db).unsafe(
    `CREATE TABLE IF NOT EXISTS ${TEAMS_TABLE} (entity_id text PRIMARY KEY, team_id text NOT NULL)`,
  );
  await insertProjects(scopedStack, userA.tenantId, [PROJ_1, PROJ_9, PROJ_2]);

  // Regression control, dedicated stack (mirrors tags.integration.test.ts's
  // openStack/defaultStack): a plain (unscoped) mount of the SAME feature,
  // used to prove the 0-rows result below is the ownership rule doing real
  // work, not an empty table or a broken query.
  defaultStack = await setupTestStack({
    features: [createNotesHistoryFeature(), projectFixtureFeature],
  });
  await unsafeCreateEntityTable(defaultStack.db, noteEntryEntity);
  await unsafeCreateEntityTable(defaultStack.db, projectEntity);
  await createEventsTable(defaultStack.db);
  await insertProjects(defaultStack, userA.tenantId, [PROJ_1]);
});

afterAll(async () => {
  await scopedStack.cleanup();
  await defaultStack.cleanup();
});

beforeEach(async () => {
  await asRawClient(scopedStack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(scopedStack.db).unsafe("DELETE FROM read_note_entries");
  await asRawClient(scopedStack.db).unsafe(`DELETE FROM ${TEAMS_TABLE}`);
  await asRawClient(defaultStack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(defaultStack.db).unsafe("DELETE FROM read_note_entries");
});

async function addNote(stack: TestStack, entityId: string, user: TestUser): Promise<void> {
  await stack.http.writeOk(
    NotesHistoryHandlers.addNote,
    { entityType: "project", entityId, body: "note" },
    user,
  );
}

async function listNotes(
  stack: TestStack,
  user: TestUser,
  filter?: { field: string; op: "eq"; value: unknown },
): Promise<Array<Record<string, unknown>>> {
  const res = await stack.http.queryOk<{ rows: Array<Record<string, unknown>> }>(
    NotesHistoryQueries.noteList,
    filter ? { filter } : {},
    user,
  );
  return res.rows;
}

describe("notes-history integration — row ownership (where-rule)", () => {
  test("a team-scoped where-rule limits list() to the caller's team, with a filter applied", async () => {
    // Both notes are authored by the SAME user (A), in the SAME tenant, both
    // rows exist in TEAMS_TABLE — the only thing that can tell them apart is
    // team_id. This is the discriminator that rules out both failure modes a
    // weaker test would miss: a broken shiftParams (team_id compared against
    // the tenant UUID or nothing → everyone sees 0) and a trivially-true
    // subquery (EXISTS matches regardless of team_id → everyone sees both).
    await addNote(scopedStack, PROJ_1, userA); // will be team-a
    await addNote(scopedStack, PROJ_9, userA); // will be team-b — same author, different team
    await asRawClient(scopedStack.db).unsafe(
      `INSERT INTO ${TEAMS_TABLE} (entity_id, team_id) VALUES ($1, $2), ($3, $4)`,
      [PROJ_1, "team-a", PROJ_9, "team-b"],
    );

    // User B (different team) sees nothing, even filtered down to the exact row.
    expect(
      await listNotes(scopedStack, userB, { field: "entityId", op: "eq", value: PROJ_1 }),
    ).toHaveLength(0);

    // User A (own team) sees it. This is the real shiftParams exercise: the
    // ownership fragment's `$N` is emitted starting at ctx.paramStart, then
    // shifted again by the outer query's already-consumed tenant-scope
    // params (2) plus the filter param (1) — if that arithmetic were wrong,
    // A would ALSO see 0 rows instead of comparing team_id against garbage.
    const ownRows = await listNotes(scopedStack, userA, {
      field: "entityId",
      op: "eq",
      value: PROJ_1,
    });
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0]?.["body"]).toBe("note");

    // Unfiltered: A authored BOTH notes, but must see only the team-a one —
    // proves the rule filters by team_id, not by authorship or a trivially-true
    // subquery (which would return both).
    const aRows = await listNotes(scopedStack, userA);
    expect(aRows).toHaveLength(1);
    expect(aRows[0]?.["entityId"]).toBe(PROJ_1);

    // B authored NEITHER note, yet must see exactly the team-b one — proves
    // the rule grants access by team membership, not by who wrote the row.
    const bRows = await listNotes(scopedStack, userB);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.["entityId"]).toBe(PROJ_9);
  });

  test("the same data on an unscoped mount leaks across teams (regression control)", async () => {
    await addNote(defaultStack, PROJ_1, userA);
    // No ownership option on this stack's feature — the pre-fix behavior.
    // Proves the 0-rows result above comes from the ownership rule, not
    // from an unrelated empty-table/broken-query artifact.
    expect(await listNotes(defaultStack, userB)).toHaveLength(1);
  });

  test("no explicit filter — ownership fragment still shifts correctly against the bare tenant scope", async () => {
    await addNote(scopedStack, PROJ_2, userA);
    await asRawClient(scopedStack.db).unsafe(
      `INSERT INTO ${TEAMS_TABLE} (entity_id, team_id) VALUES ($1, $2)`,
      [PROJ_2, "team-a"],
    );

    expect(await listNotes(scopedStack, userB)).toHaveLength(0);
    expect(await listNotes(scopedStack, userA)).toHaveLength(1);
  });
});

describe("unqualified where-rule fails closed, not open (fw#2639)", () => {
  // Same shape as `teamOwnership` above, but the subquery's inner reference
  // is left unqualified (`entity_id` instead of `t.entity_id`/`${ctx.tableName}.entity_id`).
  // Postgres binds the unqualified name to the innermost table (`t`) first,
  // so `t.entity_id = entity_id` silently becomes `t.entity_id = t.entity_id`
  // — a self-join tautology that matches every row regardless of team.
  const unqualifiedOwnership: NonNullable<EntityDefinition["access"]> = {
    read: {
      TenantMember: {
        kind: "where",
        where: (user, ctx) => {
          const team = user.claims?.["team"];
          // Boot probe has no claims and bails out here; the runtime lint in
          // ruleToFragment is what must catch the unqualified reference.
          if (typeof team !== "string") throw new Error("team claim required");
          return {
            sqlText: `EXISTS (SELECT 1 FROM ${TEAMS_TABLE} t WHERE t.entity_id = entity_id AND t.team_id = $${ctx.paramStart})`,
            params: [team],
          };
        },
      },
    },
  };

  let unqualifiedStack: TestStack;

  beforeAll(async () => {
    // Reaching this point at all proves the boot guard doesn't false-positive
    // on this rule: PROBE_USER carries no claims, so `where()` throws before
    // the lint ever sees the bad SQL, and boot-validator/ownership.ts's
    // probeWhereRule swallows that and moves on.
    unqualifiedStack = await setupTestStack({
      features: [createNotesHistoryFeature({ ownership: unqualifiedOwnership })],
    });
    await unsafeCreateEntityTable(unqualifiedStack.db, createNoteEntryEntity(unqualifiedOwnership));
    await createEventsTable(unqualifiedStack.db);
    await asRawClient(unqualifiedStack.db).unsafe(
      `CREATE TABLE IF NOT EXISTS ${TEAMS_TABLE} (entity_id text PRIMARY KEY, team_id text NOT NULL)`,
    );
  });

  afterAll(async () => {
    await unqualifiedStack.cleanup();
  });

  test("list() fails closed instead of leaking userB's row to userA", async () => {
    await addNote(unqualifiedStack, "proj-b", userB);
    await asRawClient(unqualifiedStack.db).unsafe(
      `INSERT INTO ${TEAMS_TABLE} (entity_id, team_id) VALUES ($1, $2)`,
      ["proj-b", "team-b"],
    );

    // Pre-fix: this query returned HTTP 200 with userB's row (the tautology
    // matches every row) — queryErr would throw "Expected query to fail but
    // it succeeded". Post-fix: the runtime lint in ruleToFragment throws
    // before the query ever runs, so the request fails loud instead of
    // leaking. Asserting the concrete status (not just "isSuccess: false")
    // documents exactly how it fails: an uncaught Error auto-wraps into
    // InternalError (500), not a handled 4xx.
    const error = await unqualifiedStack.http.queryErr(NotesHistoryQueries.noteList, {}, userA);
    expect(error.httpStatus).toBe(500);
    expect(error.code).toBe("internal_error");
  });

  // Green-path twin: `scopedStack` above (built with the correctly-qualified
  // `teamOwnership` rule) already proves the lint doesn't reject every
  // subquery rule — its first test asserts userA sees exactly its own
  // team's row via HTTP 200 and never userB's. Relying on that coverage
  // instead of duplicating a second correctly-qualified stack here.
});

describe("notes-history — boot guard rejects a where-rule in ownership.write", () => {
  test("createNotesHistoryFeature throws instead of shipping a create()-time landmine", () => {
    expect(() =>
      createNotesHistoryFeature({
        ownership: {
          write: {
            TenantMember: { kind: "where", where: () => ({ sqlText: "1=1", params: [] }) },
          },
        },
      }),
    ).toThrow(/ownership\.write must not contain a.*where/);
  });
});
