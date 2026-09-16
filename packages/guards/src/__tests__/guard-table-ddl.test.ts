import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { collectFindings, guard, isAllowed } from "../guard-table-ddl";

function fileAt(relPath: string, code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(`${process.cwd()}/${relPath}`, code);
}

describe("Table-DDL Guard", () => {
  test("flags an unsafePushTables() call outside the allowlist", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/feature.ts",
      'import { unsafePushTables } from "./ddl";\nexport const run = () => unsafePushTables();',
    );
    const findings = collectFindings(sf, process.cwd());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.symbol).toBe("unsafePushTables");
  });

  test("allows unsafeCreateEntityTable() inside packages/framework/src/stack/", () => {
    const sf = fileAt(
      "packages/framework/src/stack/seed.ts",
      'import { unsafeCreateEntityTable } from "./ddl";\nexport const run = () => unsafeCreateEntityTable();',
    );
    expect(collectFindings(sf, process.cwd())).toHaveLength(0);
  });

  test("isAllowed matches __tests__ and drizzle paths, not arbitrary src", () => {
    expect(isAllowed("/repo/packages/x/__tests__/setup.ts")).toBe(true);
    expect(isAllowed("/repo/apps/y/drizzle/config.ts")).toBe(true);
    expect(isAllowed("/repo/packages/x/src/rogue.ts")).toBe(false);
  });

  test("guard.run() never returns blocking violations (module header: Warnung, kein Fail)", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/feature.ts",
      'import { unsafePushTables } from "./ddl";\nexport const run = () => unsafePushTables();',
    );
    expect(guard.run([sf]).violations).toEqual([]);
  });
});
