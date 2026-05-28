import { afterEach, describe, expect, test } from "bun:test";
import { formatReport, isRawSqlAllowed, joinPath, scanRepo } from "../sql-inventory";

const cleanups: string[] = [];

afterEach(async () => {
  for (const dir of cleanups) {
    await Bun.spawn(["rm", "-rf", dir]).exited;
  }
  cleanups.length = 0;
});

async function tempRepo(files: Record<string, string>): Promise<string> {
  const root = joinPath(import.meta.dir, `.tmp-sql-inv-${crypto.randomUUID()}`);
  cleanups.push(root);
  await Promise.all(
    Object.entries(files).map(([rel, content]) => Bun.write(joinPath(root, rel), content)),
  );
  return root;
}

describe("sql-inventory", () => {
  test("isRawSqlAllowed permits db/queries and bun-db/query", () => {
    expect(isRawSqlAllowed("/repo/packages/framework/src/db/queries/event-store.ts")).toBe(true);
    expect(isRawSqlAllowed("/repo/packages/framework/src/bun-db/query.ts")).toBe(true);
    expect(
      isRawSqlAllowed("/repo/packages/bundled-features/src/sessions/db/queries/cleanup.ts"),
    ).toBe(true);
    expect(isRawSqlAllowed("/repo/samples/apps/marketing-demo/src/db/queries/seed-counts.ts")).toBe(
      true,
    );
    expect(isRawSqlAllowed("/repo/bin/commands/schema.ts")).toBe(true);
    expect(isRawSqlAllowed("/repo/scripts/codemod-bun-db-swap.ts")).toBe(true);
    expect(
      isRawSqlAllowed("/repo/packages/bundled-features/src/sessions/handlers/cleanup.job.ts"),
    ).toBe(false);
  });

  test("scanRepo classifies production vs test hits", async () => {
    const root = await tempRepo({
      "packages/framework/src/db/queries/demo.ts": `export async function x(db: unknown) {
  return asRawClient(db).unsafe("SELECT 1");
}`,
      "packages/framework/src/handlers/bad.ts": `export async function y(db: unknown) {
  return asRawClient(db).unsafe("DELETE FROM read_users");
}`,
      "packages/framework/src/__tests__/ok.integration.ts": `await asRawClient(db).unsafe("DELETE FROM read_users");`,
    });

    const report = await scanRepo(root);
    expect(report.summary.byBucket.allowed).toBeGreaterThanOrEqual(1);
    expect(report.summary.byBucket.tests).toBeGreaterThanOrEqual(1);
    expect(report.summary.byBucket.disallowed).toBeGreaterThanOrEqual(1);
    expect(formatReport(report)).toContain("sql inventory");
  });
});
