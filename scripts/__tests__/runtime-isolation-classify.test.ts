// Unit tests for the runtime-isolation classifier's path-pattern table.
//
// These tests exist because the path-pattern bugs are silent — a regex
// that doesn't match doesn't throw, it just classifies the file as
// `runtime` (the default), and the import-graph check waves through
// imports that should have been blocked. The historic case: the
// `\/scripts\/` regex didn't match `scripts/foo.ts` at repo-root
// because the leading slash anchor was wrong; the fix is `(?:^|\/)scripts\/`.
//
// Each test pins one classification rule. When the path-pattern table
// changes, the failing test names tell you which rule shifted.

import { describe, expect, test } from "vitest";
import { classifyByPath } from "../runtime-isolation-classify";

describe("classifyByPath — test-runtime patterns", () => {
  test("matches __tests__ directory anywhere in the path", () => {
    expect(classifyByPath("packages/framework/src/__tests__/foo.ts")).toBe("test");
  });

  test("matches testing/ directory anywhere in the path", () => {
    expect(classifyByPath("packages/framework/src/testing/helpers.ts")).toBe("test");
  });

  test("matches a file literally named testing.ts", () => {
    expect(classifyByPath("packages/framework/src/testing.ts")).toBe("test");
  });

  test("matches *.test.ts", () => {
    expect(classifyByPath("packages/framework/src/foo.test.ts")).toBe("test");
  });

  test("matches *.integration.ts", () => {
    expect(classifyByPath("samples/recipes/x/y.integration.ts")).toBe("test");
  });

  test("matches *.e2e.tsx", () => {
    expect(classifyByPath("samples/apps/foo.e2e.tsx")).toBe("test");
  });
});

describe("classifyByPath — tooling-runtime patterns", () => {
  test("matches scripts/ at the repo root (the historic regression)", () => {
    // This is the bug the regex fix addressed: `\/scripts\/` failed at
    // depth 0, leaving scripts/foo.ts classified as the default
    // `runtime`. The corrected pattern uses `(?:^|\/)scripts\/`.
    expect(classifyByPath("scripts/check-runtime-isolation.ts")).toBe("tooling");
  });

  test("matches scripts/ nested inside a workspace", () => {
    expect(classifyByPath("packages/framework/scripts/seed.ts")).toBe("tooling");
  });

  test("matches bin/ at the repo root", () => {
    expect(classifyByPath("bin/main.ts")).toBe("tooling");
  });

  test("matches bin/ nested inside a workspace", () => {
    expect(classifyByPath("samples/showcases/publicstatus/bin/main.ts")).toBe("tooling");
  });

  test("matches drizzle/<file>.ts but only direct children of drizzle/", () => {
    expect(classifyByPath("samples/showcases/publicstatus/drizzle/0001_init.ts")).toBe(
      "tooling",
    );
  });

  test("matches drizzle.config.ts at any depth", () => {
    expect(classifyByPath("samples/showcases/publicstatus/drizzle.config.ts")).toBe(
      "tooling",
    );
  });
});

describe("classifyByPath — non-matches fall through to null", () => {
  test("a plain runtime source file under packages/", () => {
    expect(classifyByPath("packages/framework/src/api/server.ts")).toBeNull();
  });

  test("a sample app shell that isn't bin/ or scripts/", () => {
    expect(classifyByPath("samples/recipes/basic-entity/src/feature.ts")).toBeNull();
  });

  test("does NOT match a file that just happens to contain the word 'scripts'", () => {
    // `scripts-helpers.ts` should not be tooling — only the directory
    // boundary `(^|/)scripts/` triggers the classification.
    expect(classifyByPath("packages/framework/scripts-helpers.ts")).toBeNull();
  });

  test("does NOT match an arbitrary file inside drizzle subdir tree", () => {
    // Pattern is `\/drizzle\/[^/]+\.ts$` — only direct children. A
    // file two levels below drizzle/ stays null.
    expect(
      classifyByPath("samples/showcases/publicstatus/drizzle/meta/journal.json"),
    ).toBeNull();
  });

  test("normalizes Windows backslashes before matching", () => {
    expect(classifyByPath("scripts\\foo.ts")).toBe("tooling");
  });
});
