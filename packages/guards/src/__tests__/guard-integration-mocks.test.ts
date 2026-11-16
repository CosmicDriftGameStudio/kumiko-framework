import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, countMockCalls } from "../guard-integration-mocks";
import { fixtureRoot } from "./parent-workspace-fixture";

describe("countMockCalls", () => {
  test.each([
    ["bun:test bare mock(", "const fn = mock(async () => ({}));"],
    ["bun:test bare spyOn(", 'const s = spyOn(obj, "method");'],
    ["bun:test mock.module(", 'mock.module("./x", () => ({}));'],
    ["jest.fn(", "const fn = jest.fn();"],
    ["jest.mock(", 'jest.mock("./x");'],
    ["jest.spyOn(", 'const s = jest.spyOn(obj, "m");'],
    ["vi.mock(", 'vi.mock("./x");'],
    ["vi.fn(", "const fn = vi.fn();"],
    ["vi.spyOn(", 'const s = vi.spyOn(obj, "m");'],
  ])("flags %s", (_label, source) => {
    expect(countMockCalls(source)).toBeGreaterThan(0);
  });

  test.each([
    ["member call ctx.mock(", "await ctx.mock(payload);"],
    ["member call foo.spyOn(", "foo.spyOn(arg);"],
    ["identifier mockUser(", "const u = mockUser();"],
    ["the word in text", 'const label = "mocked";'],
    ["no mock at all", 'await stack.http.writeOk("a:b:c", {}, user);'],
  ])("does not flag %s", (_label, source) => {
    expect(countMockCalls(source)).toBe(0);
  });

  test("counts every call", () => {
    expect(countMockCalls('spyOn(a, "x");\nspyOn(b, "y");')).toBe(2);
  });
});

describe("check.run", () => {
  test("freezes integration-test mocks per file and never counts unit tests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "integration-mocks-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      const integrationFile = join(dir, "src/a.integration.test.ts");
      writeFileSync(integrationFile, 'spyOn(console, "warn");\n');
      writeFileSync(join(dir, "src/b.test.ts"), 'spyOn(console, "warn");\n');
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });

      const withoutBaseline = await check.run([root]);
      expect(withoutBaseline.violations).toEqual([]);
      expect(withoutBaseline.matchedFiles).toBe(1);

      await check.writeBaseline?.([root]);
      writeFileSync(integrationFile, 'spyOn(console, "warn");\nspyOn(console, "log");\n');
      writeFileSync(join(dir, "src/b.test.ts"), 'spyOn(a, "x");\nspyOn(b, "y");\nspyOn(c, "z");\n');

      const grown = await check.run([root]);
      expect(grown.violations).toHaveLength(1);
      expect(grown.violations[0]?.file).toBe("src/a.integration.test.ts");
      expect(grown.violations[0]?.message).toMatch(/integration-test mock call\(s\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
