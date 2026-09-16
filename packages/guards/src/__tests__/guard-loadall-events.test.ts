import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { collectViolations, guard, isAllowed } from "../guard-loadall-events";

function fileAt(relPath: string, code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(`${process.cwd()}/${relPath}`, code);
}

describe("loadAllEventsByType Guard", () => {
  test("flags a loadAllEventsByType(...) call outside the allowlist", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/feature.ts",
      'declare function loadAllEventsByType(t: string): unknown;\nexport const load = () => loadAllEventsByType("x");',
    );
    const violations = collectViolations(sf);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.functionName).toBe("loadAllEventsByType");
    expect(violations[0]?.enclosingFunction).toBe("load");
  });

  test("does not flag the event-store definition itself", () => {
    const sf = fileAt(
      "packages/framework/src/event-store/event-store.ts",
      'declare function loadAllEventsByType(t: string): unknown;\nexport const load = () => loadAllEventsByType("x");',
    );
    expect(collectViolations(sf)).toHaveLength(0);
  });

  test("does not flag ops scripts under top-level scripts/", () => {
    const sf = fileAt(
      "scripts/backfill.ts",
      'declare function loadAllEventsByType(t: string): unknown;\nexport const load = () => loadAllEventsByType("x");',
    );
    expect(collectViolations(sf)).toHaveLength(0);
  });

  test("isAllowed matches only the event-store definition and top-level scripts/", () => {
    expect(isAllowed("packages/framework/src/event-store/event-store.ts")).toBe(true);
    expect(isAllowed("scripts/backfill.ts")).toBe(true);
    expect(isAllowed("packages/framework/src/features/x/scripts/backfill.ts")).toBe(false);
  });

  test("guard.run() reports the callee and enclosing function in the message", () => {
    const sf = fileAt(
      "packages/bundled-features/src/rogue/feature.ts",
      'declare function loadAllEventsByType(t: string): unknown;\nexport const load = () => loadAllEventsByType("x");',
    );
    const { violations } = guard.run([sf]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("loadAllEventsByType(...) in load");
  });
});
