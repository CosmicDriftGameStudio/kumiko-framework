// The read twin of notes-history-parent-visibility.integration.test.ts
// (fw#2766). add-note was gated against the host row's own read path, but
// `note-entry:list` returned every note of the tenant. None of the mounts
// below set `ownership`, which used to be the only lever.

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
import { userEntity } from "../../user";
import { NotesHistoryHandlers, NotesHistoryQueries } from "../constants";
import { createNoteEntryEntity, noteMentionEntity } from "../entity";
import { createNotesHistoryFeature } from "../feature";

const PROJECT_TABLE = "notes_rg_test_projects";

const teamScopedRead: NonNullable<EntityDefinition["access"]> = {
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

const projectEntity = createEntity({
  table: PROJECT_TABLE,
  fields: {
    teamId: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
  access: teamScopedRead,
});

const hostFixturesFeature = defineFeature("notes-rg-test-fixtures", (r) => {
  r.entity("project", projectEntity);
});

type TestUser = ReturnType<typeof createTestUser>;

const userA: TestUser = createTestUser({
  id: 80,
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});
const userB: TestUser = createTestUser({
  id: 81,
  roles: ["TenantMember"],
  claims: { team: "team-b" },
});

const PROJECT_A = "d0000000-0000-4000-8000-00000000000a";
const PROJECT_B = "d0000000-0000-4000-8000-00000000000b";
const ORPHAN_HOST_ID = "d0000000-0000-4000-8000-0000000000ff";

type NoteRow = { id: string; entityType: string; entityId: string; body: string };
type Page = { rows: readonly NoteRow[]; nextCursor: string | null; total?: number };

const noteEntryEntity = createNoteEntryEntity();

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    // Deliberately no `ownership` — the gate must hold on a bare mount.
    features: [createNotesHistoryFeature({ access: { openToAll: true } }), hostFixturesFeature],
  });
  await unsafeCreateEntityTable(stack.db, noteEntryEntity);
  await unsafeCreateEntityTable(stack.db, noteMentionEntity);
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, projectEntity);
  await createEventsTable(stack.db);

  await asRawClient(stack.db).unsafe(
    `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id) VALUES ($1, $3, 'team-a'), ($2, $3, 'team-b')`,
    [PROJECT_A, PROJECT_B, userA.tenantId],
  );

  await stack.http.writeOk(
    NotesHistoryHandlers.addNote,
    { entityType: "project", entityId: PROJECT_A, body: "team-a note" },
    userA,
  );
  await stack.http.writeOk(
    NotesHistoryHandlers.addNote,
    { entityType: "project", entityId: PROJECT_B, body: "team-b note" },
    userB,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

function listNotes(payload: Record<string, unknown>, user: TestUser): Promise<Page> {
  return stack.http.queryOk<Page>(NotesHistoryQueries.noteList, payload, user);
}

describe("notes-history read-gate", () => {
  test("the owning team reads the note trail of its own project", async () => {
    const page = await listNotes(
      { filter: { field: "entityId", op: "eq", value: PROJECT_A } },
      userA,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.body).toBe("team-a note");
  });

  test("a foreign team reads nothing there, without ownership being set", async () => {
    const page = await listNotes(
      { filter: { field: "entityId", op: "eq", value: PROJECT_A }, totalCount: true },
      userB,
    );
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  test("an unfiltered list returns only the notes whose host the caller can see", async () => {
    const forA = await listNotes({ totalCount: true }, userA);
    expect(forA.rows.map((r) => r.entityId)).toEqual([PROJECT_A]);
    expect(forA.total).toBe(1);

    const forB = await listNotes({ totalCount: true }, userB);
    expect(forB.rows.map((r) => r.entityId)).toEqual([PROJECT_B]);
    expect(forB.total).toBe(1);
  });

  test("a note whose entityType names no registered entity is invisible to everyone", async () => {
    const orphanId = "d0000000-0000-4000-8000-0000000000f1";
    await asRawClient(stack.db).unsafe(
      `INSERT INTO read_note_entries (id, tenant_id, entity_type, entity_id, body)
       VALUES ($1, $2, 'not-a-registered-entity', $3, 'orphan')`,
      [orphanId, userA.tenantId, ORPHAN_HOST_ID],
    );

    for (const user of [userA, userB]) {
      const page = await listNotes(
        { filter: { field: "entityId", op: "eq", value: ORPHAN_HOST_ID }, totalCount: true },
        user,
      );
      expect(page.rows).toHaveLength(0);
      expect(page.total).toBe(0);
    }

    const raw = await asRawClient(stack.db).unsafe<{ n: number }>(
      "SELECT count(*)::int AS n FROM read_note_entries WHERE id = $1",
      [orphanId],
    );
    expect(raw[0]?.n).toBe(1);
  });
});

describe("notes-history read-gate — parents allowlist narrows both paths", () => {
  const OTHER_TABLE = "notes_rg_other_hosts";
  const otherEntity = createEntity({
    table: OTHER_TABLE,
    fields: {
      label: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
    },
  });
  const fixtures = defineFeature("notes-rg-parents-fixtures", (r) => {
    r.entity("project", projectEntity);
    r.entity("widget", otherEntity);
  });
  const WIDGET = "d0000000-0000-4000-8000-00000000002a";

  let allowStack: TestStack;

  beforeAll(async () => {
    allowStack = await setupTestStack({
      features: [
        createNotesHistoryFeature({ access: { openToAll: true }, parents: ["project"] }),
        fixtures,
      ],
    });
    await unsafeCreateEntityTable(allowStack.db, createNoteEntryEntity(undefined, ["project"]));
    await unsafeCreateEntityTable(allowStack.db, noteMentionEntity);
    await unsafeCreateEntityTable(allowStack.db, userEntity);
    await unsafeCreateEntityTable(allowStack.db, projectEntity);
    await unsafeCreateEntityTable(allowStack.db, otherEntity);
    await createEventsTable(allowStack.db);
    await asRawClient(allowStack.db).unsafe(
      `INSERT INTO ${PROJECT_TABLE} (id, tenant_id, team_id) VALUES ($1, $2, 'team-a')`,
      [PROJECT_A, userA.tenantId],
    );
    await asRawClient(allowStack.db).unsafe(
      `INSERT INTO ${OTHER_TABLE} (id, tenant_id, label) VALUES ($1, $2, 'w')`,
      [WIDGET, userA.tenantId],
    );
  });

  afterAll(async () => {
    await allowStack.cleanup();
  });

  test("a host type outside the allowlist is rejected on write", async () => {
    const err = await allowStack.http.writeErr(
      NotesHistoryHandlers.addNote,
      { entityType: "widget", entityId: WIDGET, body: "nope" },
      userA,
    );
    expect(err.code).toBe("not_found");
  });

  test("a row that slipped in on a non-allowlisted host stays invisible on read", async () => {
    const smuggled = "d0000000-0000-4000-8000-0000000000f2";
    await asRawClient(allowStack.db).unsafe(
      `INSERT INTO read_note_entries (id, tenant_id, entity_type, entity_id, body)
       VALUES ($1, $2, 'widget', $3, 'smuggled')`,
      [smuggled, userA.tenantId, WIDGET],
    );
    const page = await allowStack.http.queryOk<Page>(
      NotesHistoryQueries.noteList,
      { filter: { field: "entityId", op: "eq", value: WIDGET }, totalCount: true },
      userA,
    );
    expect(page.rows).toHaveLength(0);
    expect(page.total).toBe(0);
  });
});
