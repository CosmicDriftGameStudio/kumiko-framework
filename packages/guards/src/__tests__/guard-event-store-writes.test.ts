import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Project } from "ts-morph";
import { collectViolations, guard, isAllowed } from "../guard-event-store-writes";
import { fixtureRoot } from "./parent-workspace-fixture";

function fileAt(relPath: string, code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(`${process.cwd()}/${relPath}`, code);
}

describe("Event-Store-Writes Guard", () => {
  test("flags an UPDATE against kumiko_events outside the allowlist", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/move.ts",
      'declare function run(sql: string): unknown;\nexport const move = () => run(`UPDATE "kumiko_events" SET tenant_id = $1 WHERE id = $2`);',
    );
    const violations = collectViolations(sf);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.snippet).toContain("kumiko_events");
  });

  test("flags a DELETE FROM kumiko_snapshots outside the allowlist", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/move.ts",
      'declare function run(sql: string): unknown;\nexport const drop = () => run("DELETE FROM \\"kumiko_snapshots\\" WHERE tenant_id = $1");',
    );
    expect(collectViolations(sf)).toHaveLength(1);
  });

  test("flags an INSERT INTO kumiko_archived_streams outside the allowlist", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/move.ts",
      'declare function run(sql: string): unknown;\nexport const archive = () => run(`INSERT INTO "kumiko_archived_streams" (tenant_id) VALUES ($1)`);',
    );
    expect(collectViolations(sf)).toHaveLength(1);
  });

  test("does not flag a literal mentioning none of the three tables", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/move.ts",
      'declare function run(sql: string): unknown;\nexport const touch = () => run(`UPDATE "handover_run" SET tenant_id = $1 WHERE id = $2`);',
    );
    expect(collectViolations(sf)).toHaveLength(0);
  });

  test("does not flag the event-store primitive itself", () => {
    const sf = fileAt(
      "packages/framework/src/event-store/transfer.ts",
      'declare function run(sql: string): unknown;\nexport const move = () => run(`UPDATE "kumiko_events" SET tenant_id = $1`);',
    );
    expect(collectViolations(sf)).toHaveLength(0);
  });

  test("does not flag the event-store backing queries", () => {
    const sf = fileAt(
      "packages/framework/src/db/queries/event-store-transfer.ts",
      'declare function run(sql: string): unknown;\nexport const move = () => run(`UPDATE "kumiko_events" SET tenant_id = $1`);',
    );
    expect(collectViolations(sf)).toHaveLength(0);
  });

  test("does not flag the pre-existing pii backfill and stream-tenant-backfill exceptions", () => {
    expect(isAllowed("packages/framework/src/db/queries/backfill-pii.ts")).toBe(true);
    expect(
      isAllowed("packages/bundled-features/src/user/db/queries/stream-tenant-backfill.ts"),
    ).toBe(true);
  });

  test("isAllowed rejects a feature path that merely mentions event-store in its name", () => {
    expect(isAllowed("packages/bundled-features/src/event-store-lookalike/move.ts")).toBe(false);
  });

  test("classifies an event-store file against the runner's roots, not the cwd repo", () => {
    // A multi-repo runner invoked from the parent workspace dir hands in a
    // root whose absPath differs from process.cwd() — the file's path then
    // carries a leading `kumiko-framework/` segment that a cwd-relative
    // computation would never strip, wrongly flagging this allowed file.
    const parkedRoot = fixtureRoot("kumiko-framework", "/virtual/packages/wt/kumiko-framework", {
      kind: "framework",
      sourceRoots: ["packages/*/src", "samples"],
      testGlobs: ["packages/*/src/**/*.{test,integration}.{ts,tsx}"],
    });
    const project = new Project({ useInMemoryFileSystem: true });
    const parkedFile = project.createSourceFile(
      join(parkedRoot.absPath, "packages/framework/src/event-store/transfer.ts"),
      'declare function run(sql: string): unknown;\nexport const move = () => run(`UPDATE "kumiko_events" SET tenant_id = $1`);',
    );
    expect(collectViolations(parkedFile, [parkedRoot])).toHaveLength(0);
  });

  test("guard.run() reports the offending snippet", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/move.ts",
      'declare function run(sql: string): unknown;\nexport const move = () => run(`UPDATE "kumiko_events" SET tenant_id = $1`);',
    );
    const { violations } = guard.run([sf]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("kumiko_events");
  });
});
