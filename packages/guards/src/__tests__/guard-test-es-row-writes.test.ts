import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { RAW_SQL_MESSAGE, SEED_ROW_MESSAGE } from "../_lib/test-es-raw-writes";
import { guard } from "../guard-test-es-row-writes";

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
    'const noteTable = buildEntityTable("note", {} as never);\n' +
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
});

describe("Test-ES-Row-Writes Guard :: raw SQL", () => {
  const RAW_PREAMBLE =
    'import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";\n' +
    'import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";\n' +
    "declare const client: { unsafe(sql: string): Promise<void> };\n" +
    'const noteTable = buildEntityTable("note", {} as never);\n' +
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
});
