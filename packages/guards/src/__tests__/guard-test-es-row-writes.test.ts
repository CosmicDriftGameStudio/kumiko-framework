import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import {
  EVENTS_TABLE_WRITE_MESSAGE,
  RAW_SQL_MESSAGE,
  SEED_ROW_MESSAGE,
} from "../_lib/test-es-raw-writes";
import { guard } from "../guard-test-es-row-writes";
import { fixtureRoot } from "./parent-workspace-fixture";

function messagesFor(relPath: string, code: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(`${process.cwd()}/${relPath}`, code);
  return guard.run([sf]).violations.map((v) => v.message);
}

const TEST_PATH = "packages/bundled-features/src/x/__tests__/x.integration.test.ts";
const IMPORT = 'import { updateRows, deleteRows } from "@cosmicdrift/kumiko-testing/helpers";\n';

describe("Test-ES-Row-Writes Guard", () => {
  test("flags updateRows and deleteRows imported from the testing helpers", () => {
    const messages = messagesFor(
      TEST_PATH,
      `${IMPORT}declare const db: never;\nexport const a = () => updateRows(db, {} as never, {}, {});\nexport const b = () => deleteRows(db, {} as never, {});`,
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("updateRowViaEventStore");
  });

  test("flags a call through a namespace import", () => {
    const messages = messagesFor(
      TEST_PATH,
      'import * as helpers from "@cosmicdrift/kumiko-testing/helpers";\ndeclare const db: never;\nexport const a = () => helpers.deleteRows(db, {} as never, {});',
    );
    expect(messages).toHaveLength(1);
  });

  test("flags a raw DELETE spelled with a hex escape", () => {
    const messages = messagesFor(
      TEST_PATH,
      'export const q = "DELETE\\x20FROM kumiko_events WHERE true";',
    );
    expect(messages).toEqual([RAW_SQL_MESSAGE]);
  });

  test("lets updateRows and deleteRows with a projectionOnly reason through", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${IMPORT}declare const db: never;\nconst projectionOnly = "lost read table";\n` +
          'export const a = () => updateRows(db, {} as never, { version: 0 }, {}, { projectionOnly: "stale version race" });\n' +
          "export const b = () => deleteRows(db, {} as never, {}, { projectionOnly });",
      ),
    ).toEqual([]);
  });

  test("ignores a same-named local function without the testing import", () => {
    expect(
      messagesFor(
        TEST_PATH,
        "function updateRows(rows: number[]) { return rows; }\nexport const a = () => updateRows([1]);",
      ),
    ).toEqual([]);
  });

  test("allows an allowlisted file", () => {
    const code = `${IMPORT}declare const db: never;\nexport const a = () => deleteRows(db, {} as never, {});`;
    expect(
      messagesFor(
        "packages/bundled-features/src/inbound-mail-foundation/__tests__/watch-supervisor.integration.test.ts",
        code,
      ),
    ).toEqual([]);
  });
});

describe("Test-ES-Row-Writes Guard :: seedRow", () => {
  const SEED_IMPORT =
    'import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";\n' +
    'import { buildEntityTable, table } from "@cosmicdrift/kumiko-framework/db";\n' +
    'import { importedTable } from "./schema";\n' +
    "declare const db: never;\n" +
    "const noteTable = buildEntityTable({} as never);\n" +
    'const plainTable = table("store_plain", {});\n';

  test("flags seedRow on an entity table built in the file", () => {
    expect(
      messagesFor(TEST_PATH, `${SEED_IMPORT}export const a = () => seedRow(db, noteTable, {});`),
    ).toEqual([SEED_ROW_MESSAGE]);
  });

  test("ignores seedRow on a plain table and on an imported table it cannot classify", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${SEED_IMPORT}export const a = () => seedRow(db, plainTable, {});\nexport const b = () => seedRow(db, importedTable, {});`,
      ),
    ).toEqual([]);
  });

  test("lets seedRow with a projectionOnly reason through, inline or through a const", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${SEED_IMPORT}const LEGACY = { projectionOnly: "legacy row without its aggregate" };\n` +
          'export const a = () => seedRow(db, noteTable, {}, { projectionOnly: "legacy row" });\n' +
          "export const b = () => seedRow(db, noteTable, {}, LEGACY);",
      ),
    ).toEqual([]);
  });

  test("flags seedRow with an empty projectionOnly reason", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${SEED_IMPORT}export const a = () => seedRow(db, noteTable, {}, { projectionOnly: " " });`,
      ),
    ).toEqual([SEED_ROW_MESSAGE]);
  });
});

describe("Test-ES-Row-Writes Guard :: raw SQL", () => {
  const RAW_PREAMBLE =
    'import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";\n' +
    'import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";\n' +
    "declare const client: { unsafe(sql: string): Promise<void> };\n" +
    "const noteTable = buildEntityTable({} as never);\n" +
    "declare const otherTable: { tableName: string };\n";

  test("flags DELETE and UPDATE literals on read_ tables and DELETE on kumiko_events", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const a = () => client.unsafe("DELETE FROM read_notes");\n` +
          `export const b = () => client.unsafe('UPDATE "read_notes" SET x = 1');\n` +
          "export const c = () => client.unsafe(`DELETE FROM kumiko_events`);",
      ),
    ).toEqual([RAW_SQL_MESSAGE, RAW_SQL_MESSAGE, RAW_SQL_MESSAGE]);
  });

  test("flags templates on eventsTable and on an entity table built in the file", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const a = () => client.unsafe(\`DELETE FROM "\${eventsTable.tableName}"\`);\n` +
          "export const b = () => client.unsafe(`UPDATE \x24{noteTable.tableName} SET x = 1`);",
      ),
    ).toEqual([RAW_SQL_MESSAGE, RAW_SQL_MESSAGE]);
  });

  test("leaves UPDATE kumiko_events to the fixtures guard and ignores other tables", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const a = () => client.unsafe("UPDATE kumiko_events SET type = 'x'");\n` +
          'export const b = () => client.unsafe("DELETE FROM store_jobs");\n' +
          "export const c = () => client.unsafe(`DELETE FROM \x24{otherTable.tableName}`);\n" +
          'export const d = () => client.unsafe("SELECT * FROM read_notes");',
      ),
    ).toEqual([]);
  });

  test("flags raw INSERT, TRUNCATE and eventsTable row writes in the framework repo too", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const a = () => client.unsafe("INSERT INTO read_notes (id) VALUES (1)");\n` +
          'export const b = () => client.unsafe("TRUNCATE read_notes");\n' +
          'import { insertMany } from "@cosmicdrift/kumiko-framework/db";\n' +
          "export const c = () => insertMany(client as never, eventsTable, []);",
      ),
    ).toEqual([EVENTS_TABLE_WRITE_MESSAGE, RAW_SQL_MESSAGE, RAW_SQL_MESSAGE]);
  });

  const ENTITY_PREAMBLE =
    `${RAW_PREAMBLE}import { createEntity } from "@cosmicdrift/kumiko-framework/engine";\n` +
    'const PROJECT_TABLE = "rg_test_projects";\n' +
    'const projectEntity = createEntity({ name: "project", table: PROJECT_TABLE, fields: {} });\n' +
    'createEntity({ name: "memo", table: "rg_test_memos", fields: {} });\n';

  test("flags writes through a const naming an entity's table", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${ENTITY_PREAMBLE}export const a = () => client.unsafe(\`INSERT INTO \x24{PROJECT_TABLE} (id) VALUES (1)\`);\n` +
          'const LIVE_TABLE = "read_per_group";\n' +
          'export const b = () => client.unsafe(`UPDATE "\x24{LIVE_TABLE}" SET n = 1`);\n' +
          "const NOTE_TABLE = noteTable.tableName;\n" +
          "export const c = () => client.unsafe(`DELETE FROM \x24{NOTE_TABLE}`);\n" +
          "export const d = () => client.unsafe(`TRUNCATE \x24{PROJECT_TABLE}`);",
      ),
    ).toEqual(Array.from({ length: 4 }, () => RAW_SQL_MESSAGE));
  });

  test("flags literal writes on a table declared by createEntity in the file", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${ENTITY_PREAMBLE}export const a = () => client.unsafe("DELETE FROM rg_test_memos");\n` +
          "export const b = () => client.unsafe('UPDATE \"rg_test_projects\" SET x = 1');\n" +
          'export const c = () => client.unsafe("TRUNCATE rg_test_memos, rg_test_projects");',
      ),
    ).toEqual([RAW_SQL_MESSAGE, RAW_SQL_MESSAGE, RAW_SQL_MESSAGE]);
  });

  test("ignores consts naming non-entity tables and a reset together with kumiko_events", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${ENTITY_PREAMBLE}const TEAMS_TABLE = "rg_test_teams";\n` +
          'const storeTable = table("store_counters", {});\n' +
          "const STORE_NAME = storeTable.tableName;\n" +
          "export const a = () => client.unsafe(`INSERT INTO \x24{TEAMS_TABLE} (id) VALUES (1)`);\n" +
          "export const b = () => client.unsafe(`DELETE FROM \x24{STORE_NAME}`);\n" +
          'export const c = () => client.unsafe("DELETE FROM rg_test_projects_archive");\n' +
          "export const d = () => client.unsafe(`TRUNCATE \x24{PROJECT_TABLE}, kumiko_events`);\n" +
          "export const e = () => client.unsafe(`SELECT * FROM \x24{PROJECT_TABLE}`);",
      ),
    ).toEqual([]);
  });

  test("ignores a createEntity table derived as unmanaged, still flags the managed one", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${ENTITY_PREAMBLE}const storeEntity = createEntity({ name: "s", table: "rg_test_store", fields: {} });\n` +
          'const storeMeta = deriveEntityTableMeta(storeEntity, { source: "unmanaged" });\n' +
          'export const a = () => client.unsafe("UPDATE rg_test_store SET x = 1");\n' +
          'export const b = () => client.unsafe("UPDATE rg_test_projects SET x = 1");',
      ),
    ).toEqual([RAW_SQL_MESSAGE]);
  });

  test("lets a projection's apply handler write its own table", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const projection = {\n` +
          "  apply: {\n" +
          '    "note.created": async () => client.unsafe("INSERT INTO read_note_counts (n) VALUES (1)"),\n' +
          "  },\n" +
          "};\n" +
          'export const seed = () => client.unsafe("INSERT INTO read_note_counts (n) VALUES (1)");',
      ),
    ).toEqual([RAW_SQL_MESSAGE]);
  });

  test("flags writes with a schema prefix, ONLY, MERGE INTO and COPY … FROM", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const a = () => client.unsafe("UPDATE public.read_notes SET x = 1");\n` +
          `export const b = () => client.unsafe('DELETE FROM "public"."read_notes"');\n` +
          'export const c = () => client.unsafe("UPDATE ONLY read_notes SET x = 1");\n' +
          'export const d = () => client.unsafe("DELETE FROM ONLY public.read_notes");\n' +
          'export const e = () => client.unsafe("MERGE INTO read_notes USING src ON true");\n' +
          'export const f = () => client.unsafe("COPY public.read_notes (id) FROM STDIN");',
      ),
    ).toEqual(Array.from({ length: 6 }, () => RAW_SQL_MESSAGE));
  });

  test("ignores COPY … TO, reads with a schema prefix and non-entity tables behind ONLY", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const a = () => client.unsafe("COPY public.read_notes TO STDOUT");\n` +
          'export const b = () => client.unsafe("SELECT * FROM public.read_notes");\n' +
          'export const c = () => client.unsafe("UPDATE ONLY public.store_counters SET n = 1");',
      ),
    ).toEqual([]);
  });

  test("flags TRUNCATE kumiko_events without the projection in a file that knows one", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const a = () => client.unsafe("TRUNCATE kumiko_events RESTART IDENTITY");\n` +
          'export const b = () => client.unsafe("TRUNCATE public.kumiko_events, kumiko_snapshots");',
      ),
    ).toEqual([RAW_SQL_MESSAGE, RAW_SQL_MESSAGE]);
  });

  test("ignores TRUNCATE kumiko_events in a pure event-store test without projections", () => {
    expect(
      messagesFor(
        TEST_PATH,
        "declare const client: { unsafe(sql: string): Promise<void> };\n" +
          'export const a = () => client.unsafe("TRUNCATE kumiko_events, kumiko_snapshots RESTART IDENTITY");',
      ),
    ).toEqual([]);
  });

  test("never exempts writes on the events table inside a projection's apply", () => {
    expect(
      messagesFor(
        TEST_PATH,
        `${RAW_PREAMBLE}export const projection = {\n` +
          "  apply: {\n" +
          '    "a.created": async () => client.unsafe("INSERT INTO kumiko_events (id) VALUES (1)"),\n' +
          '    "a.updated": async () => client.unsafe("DELETE FROM kumiko_events"),\n' +
          '    "a.removed": async () => client.unsafe("TRUNCATE kumiko_events"),\n' +
          '    "a.counted": async () => client.unsafe("UPDATE read_note_counts SET n = n + 1"),\n' +
          "  },\n" +
          "};",
      ),
    ).toEqual([RAW_SQL_MESSAGE, RAW_SQL_MESSAGE, RAW_SQL_MESSAGE]);
  });
});

describe("Test-ES-Row-Writes Guard :: consumer repo", () => {
  const APP_DIR = "/virtual/app";
  const APP_ROOT = fixtureRoot("app-fixture", APP_DIR, {
    kind: "app",
    sourceRoots: ["src"],
    testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
  });
  const APP_TEST_PATH = `${APP_DIR}/src/__tests__/share.integration.test.ts`;
  const APP_PREAMBLE =
    'import { asRawClient, buildEntityTable } from "@cosmicdrift/kumiko-framework/db";\n' +
    'import { eventsTable as events } from "@cosmicdrift/kumiko-framework/event-store";\n' +
    'import { clearTables, deleteRows, seedRow } from "@cosmicdrift/kumiko-testing/helpers";\n' +
    "declare const stack: { db: never };\n" +
    "declare const goldenTable: string;\n" +
    "const noteTable = buildEntityTable({} as never);\n";

  function appMessagesFor(code: string): string[] {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(APP_TEST_PATH, `${APP_PREAMBLE}${code}`);
    return guard.run([sf], [APP_ROOT]).violations.map((v) => v.message);
  }

  test("flags raw INSERT, UPDATE, DELETE and TRUNCATE on read_ tables through asRawClient", () => {
    expect(
      appMessagesFor(
        "const raw = asRawClient(stack.db);\n" +
          'export const a = () => raw.unsafe(`UPDATE "read_share_tokens" SET "version" = 0 WHERE "id" = $1`, [1]);\n' +
          "export const b = () => raw.unsafe(`INSERT INTO read_share_tokens (id) VALUES ($1)`, [1]);\n" +
          'export const c = () => raw.unsafe("DELETE FROM read_share_tokens");\n' +
          "export const d = () => asRawClient(stack.db).unsafe('TRUNCATE TABLE \"read_users\"');\n" +
          "export const e = () => raw.unsafe(`INSERT INTO \x24{noteTable.tableName} (id) VALUES (1)`);\n" +
          'export const f = () => raw.unsafe(`TRUNCATE "\x24{noteTable.tableName}" RESTART IDENTITY`);',
      ),
    ).toEqual(Array.from({ length: 6 }, () => RAW_SQL_MESSAGE));
  });

  test("does not report DDL, a reset together with kumiko_events or a CSS class", () => {
    expect(
      appMessagesFor(
        "const raw = asRawClient(stack.db);\n" +
          "export const a = () => raw.unsafe(`ALTER TABLE \x24{goldenTable} RENAME TO \x24{goldenTable}_offline`);\n" +
          'export const b = () => raw.unsafe(`TRUNCATE "read_pattern_files", "read_apps", "kumiko_events" RESTART IDENTITY CASCADE`);\n' +
          "export const c = () => raw.unsafe(`TRUNCATE \x24{events.tableName}, read_users`);\n" +
          'export const d = () => raw.unsafe("CREATE TABLE read_scratch (id int)");\n' +
          "export const e = (x: string) => `min-w-0 truncate \x24{x}`;",
      ),
    ).toEqual([]);
  });

  test("flags row writes on the events table even with a projectionOnly reason", () => {
    expect(
      appMessagesFor(
        'export const a = () => deleteRows(stack.db, events, {}, { projectionOnly: "drop one event" });\n' +
          "export const b = () => seedRow(stack.db, events, {});",
      ),
    ).toEqual([EVENTS_TABLE_WRITE_MESSAGE, EVENTS_TABLE_WRITE_MESSAGE]);
  });

  test("lets projectionOnly writes and a reset of projection plus events through", () => {
    expect(
      appMessagesFor(
        'export const a = () => seedRow(stack.db, noteTable, {}, { projectionOnly: "legacy row" });\n' +
          'export const b = () => deleteRows(stack.db, noteTable, {}, { projectionOnly: "lost read table" });\n' +
          "export const c = () => clearTables(stack.db, [noteTable, events]);",
      ),
    ).toEqual([]);
  });
});
