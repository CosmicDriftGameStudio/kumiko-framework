import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrateOpenToAllSource } from "../scripts/codemod/migrate-open-to-all";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "migrate-open-to-all");
const DEFAULT_REASON = "test handler callable by any signed-in test user";

function readFixture(name: string): { input: string; expected: string } {
  return {
    input: readFileSync(join(FIXTURES_DIR, `${name}.input.ts`), "utf8"),
    expected: readFileSync(join(FIXTURES_DIR, `${name}.expected.ts`), "utf8"),
  };
}

describe("migrateOpenToAllSource", () => {
  it("rewrites a top-level openToAll: true in a *.test.ts file to the default test reason", () => {
    const { input, expected } = readFixture("test-simple");
    const result = migrateOpenToAllSource(input, "widget-list.test.ts", {
      testReason: DEFAULT_REASON,
    });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(1);
    expect(result.rewrites[0]?.after).toBe(`openToAll: { reason: "${DEFAULT_REASON}" }`);
    expect(result.manual).toHaveLength(0);
  });

  it("rewrites openToAll: true under a __tests__/ path even without a .test.ts suffix", () => {
    const { input, expected } = readFixture("test-simple");
    const result = migrateOpenToAllSource(input, "packages/framework/__tests__/widget-list.ts", {
      testReason: DEFAULT_REASON,
    });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(1);
  });

  it("honors a custom --test-reason for test files", () => {
    const { input } = readFixture("test-simple");
    const result = migrateOpenToAllSource(input, "widget-list.test.ts", {
      testReason: "custom reason for this suite",
    });

    expect(result.output).toContain(
      'access: { openToAll: { reason: "custom reason for this suite" } }',
    );
  });

  it("rewrites nested shorthand openToAll: true (verbAccess, read.access) in test files", () => {
    const { input, expected } = readFixture("test-nested-shorthand");
    const result = migrateOpenToAllSource(input, "config.test.ts", { testReason: DEFAULT_REASON });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(2);
    expect(result.manual).toHaveLength(0);
  });

  it("leaves non-test files untouched and reports manual sites with derived handler name + description", () => {
    const { input, expected } = readFixture("manual-only");
    const result = migrateOpenToAllSource(input, "handlers.ts", { testReason: DEFAULT_REASON });

    expect(result.output).toBe(expected);
    expect(result.rewrites).toHaveLength(0);
    expect(result.manual).toHaveLength(2);

    const withDescription = result.manual.find((m) => m.handlerName === "widget:list");
    expect(withDescription).toBeDefined();
    expect(withDescription?.description).toBe("Lists all widgets; visible to everyone");
    expect(withDescription?.line).toBe(7);

    const withoutDescription = result.manual.find((m) => m.handlerName === "legacy:ping");
    expect(withoutDescription).toBeDefined();
    expect(withoutDescription?.description).toBeUndefined();
    expect(withoutDescription?.line).toBe(14);
  });

  it("never rewrites in a non-test file, even when a description is present", () => {
    const { input } = readFixture("manual-only");
    const result = migrateOpenToAllSource(input, "handlers.ts", { testReason: DEFAULT_REASON });

    expect(result.output).toContain("access: { openToAll: true }");
  });
});
