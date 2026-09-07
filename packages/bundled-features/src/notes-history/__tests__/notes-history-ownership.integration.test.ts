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

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
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

beforeAll(async () => {
  scopedStack = await setupTestStack({
    features: [createNotesHistoryFeature({ ownership: teamOwnership })],
  });
  await unsafeCreateEntityTable(scopedStack.db, createNoteEntryEntity(teamOwnership));
  await createEventsTable(scopedStack.db);
  await asRawClient(scopedStack.db).unsafe(
    `CREATE TABLE IF NOT EXISTS ${TEAMS_TABLE} (entity_id text PRIMARY KEY, team_id text NOT NULL)`,
  );

  // Regression control, dedicated stack (mirrors tags.integration.test.ts's
  // openStack/defaultStack): a plain (unscoped) mount of the SAME feature,
  // used to prove the 0-rows result below is the ownership rule doing real
  // work, not an empty table or a broken query.
  defaultStack = await setupTestStack({ features: [createNotesHistoryFeature()] });
  await unsafeCreateEntityTable(defaultStack.db, noteEntryEntity);
  await createEventsTable(defaultStack.db);
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
    await addNote(scopedStack, "proj-1", userA); // will be team-a
    await addNote(scopedStack, "proj-9", userA); // will be team-b — same author, different team
    await asRawClient(scopedStack.db).unsafe(
      `INSERT INTO ${TEAMS_TABLE} (entity_id, team_id) VALUES ($1, $2), ($3, $4)`,
      ["proj-1", "team-a", "proj-9", "team-b"],
    );

    // User B (different team) sees nothing, even filtered down to the exact row.
    expect(
      await listNotes(scopedStack, userB, { field: "entityId", op: "eq", value: "proj-1" }),
    ).toHaveLength(0);

    // User A (own team) sees it. This is the real shiftParams exercise: the
    // ownership fragment's `$N` is emitted starting at ctx.paramStart, then
    // shifted again by the outer query's already-consumed tenant-scope
    // params (2) plus the filter param (1) — if that arithmetic were wrong,
    // A would ALSO see 0 rows instead of comparing team_id against garbage.
    const ownRows = await listNotes(scopedStack, userA, {
      field: "entityId",
      op: "eq",
      value: "proj-1",
    });
    expect(ownRows).toHaveLength(1);
    expect(ownRows[0]?.["body"]).toBe("note");

    // Unfiltered: A authored BOTH notes, but must see only the team-a one —
    // proves the rule filters by team_id, not by authorship or a trivially-true
    // subquery (which would return both).
    const aRows = await listNotes(scopedStack, userA);
    expect(aRows).toHaveLength(1);
    expect(aRows[0]?.["entityId"]).toBe("proj-1");

    // B authored NEITHER note, yet must see exactly the team-b one — proves
    // the rule grants access by team membership, not by who wrote the row.
    const bRows = await listNotes(scopedStack, userB);
    expect(bRows).toHaveLength(1);
    expect(bRows[0]?.["entityId"]).toBe("proj-9");
  });

  test("the same data on an unscoped mount leaks across teams (regression control)", async () => {
    await addNote(defaultStack, "proj-1", userA);
    // No ownership option on this stack's feature — the pre-fix behavior.
    // Proves the 0-rows result above comes from the ownership rule, not
    // from an unrelated empty-table/broken-query artifact.
    expect(await listNotes(defaultStack, userB)).toHaveLength(1);
  });

  test("no explicit filter — ownership fragment still shifts correctly against the bare tenant scope", async () => {
    await addNote(scopedStack, "proj-2", userA);
    await asRawClient(scopedStack.db).unsafe(
      `INSERT INTO ${TEAMS_TABLE} (entity_id, team_id) VALUES ($1, $2)`,
      ["proj-2", "team-a"],
    );

    expect(await listNotes(scopedStack, userB)).toHaveLength(0);
    expect(await listNotes(scopedStack, userA)).toHaveLength(1);
  });
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
