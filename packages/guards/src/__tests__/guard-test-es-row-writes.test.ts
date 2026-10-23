import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
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
