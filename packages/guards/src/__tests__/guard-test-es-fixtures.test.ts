import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-test-es-fixtures";

function messagesFor(relPath: string, code: string): string[] {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile(`${process.cwd()}/${relPath}`, code);
  return guard.run([sf]).violations.map((v) => v.message);
}

const TEST_PATH = "packages/bundled-features/src/x/__tests__/x.integration.test.ts";

describe("Test-ES-Fixtures Guard", () => {
  test("flags an UPDATE kumiko_events backdating in a test", () => {
    const messages = messagesFor(
      TEST_PATH,
      "export const q = `UPDATE kumiko_events SET created_at = now() - interval '30 days'`;",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("runSeedWritesAt");
  });

  test("flags hand-written read_tenant_memberships DDL", () => {
    const messages = messagesFor(
      TEST_PATH,
      "export const ddl = `CREATE TABLE IF NOT EXISTS read_tenant_memberships (id uuid PRIMARY KEY)`;",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("unsafeCreateEntityTable");
  });

  test("allows the perf bulk seeds", () => {
    const code = 'export const q = "INSERT INTO kumiko_events (id) VALUES (1)";';
    expect(
      messagesFor("packages/framework/src/event-store/__tests__/perf.integration.test.ts", code),
    ).toEqual([]);
  });

  test("ignores reads and unrelated tables", () => {
    expect(
      messagesFor(
        TEST_PATH,
        'export const q = "SELECT * FROM kumiko_events"; export const r = "INSERT INTO read_users (id) VALUES (1)";',
      ),
    ).toEqual([]);
  });
});
