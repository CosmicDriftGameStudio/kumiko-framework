import { describe, expect, test } from "bun:test";
import {
  hasDisallowedMock,
  isMockGuardAllowlisted,
  MOCK_GUARD_ALLOWLIST,
} from "../integration-mock-guard";

describe("hasDisallowedMock", () => {
  test.each([
    ['bun:test bare mock(', 'const fn = mock(async () => ({}));'],
    ['bun:test bare spyOn(', 'const s = spyOn(obj, "method");'],
    ['bun:test mock.module(', 'mock.module("./x", () => ({}));'],
    ['bun:test jest.fn(', 'const fn = jest.fn();'],
    ['bun:test jest.mock(', 'jest.mock("./x");'],
    ['bun:test jest.spyOn(', 'const s = jest.spyOn(obj, "m");'],
    ['legacy vitest vi.mock(', 'vi.mock("./x");'],
    ['legacy vitest vi.fn(', 'const fn = vi.fn();'],
    ['legacy vitest vi.spyOn(', 'const s = vi.spyOn(obj, "m");'],
  ])("flags %s", (_label, source) => {
    expect(hasDisallowedMock(source)).toBe(true);
  });

  test.each([
    ['member call ctx.mock(', 'await ctx.mock(payload);'],
    ['member call foo.spyOn(', 'foo.spyOn(arg);'],
    ['identifier substring (mocking)', 'const mocking = setupMocking();'],
    ['identifier substring (spyOnce)', 'await spyOnce.run();'],
    ['no mock at all', 'const x = await stack.http.writeOk("a:b:c", {}, user);'],
  ])("does NOT flag %s", (_label, source) => {
    expect(hasDisallowedMock(source)).toBe(false);
  });

  test("flags a realistic bun:test integration snippet", () => {
    const source = [
      'import { mock, test } from "bun:test";',
      "const dispatcher = { write: mock(async () => ({ isSuccess: true })) };",
    ].join("\n");
    expect(hasDisallowedMock(source)).toBe(true);
  });
});

describe("isMockGuardAllowlisted", () => {
  test("matches the grandfathered known-debt paths", () => {
    for (const p of MOCK_GUARD_ALLOWLIST) {
      expect(isMockGuardAllowlisted(p)).toBe(true);
    }
  });

  test("normalises backslash paths to forward slashes", () => {
    const [first] = [...MOCK_GUARD_ALLOWLIST];
    if (!first) throw new Error("allowlist must not be empty for this test");
    expect(isMockGuardAllowlisted(first.split("/").join("\\"))).toBe(true);
  });

  test("does not allowlist an arbitrary integration test", () => {
    expect(
      isMockGuardAllowlisted("packages/framework/src/x/__tests__/new.integration.test.ts"),
    ).toBe(false);
  });
});

// 233/3: der eigentliche Integrationspfad (File-Walk → Allowlist-Exemption
// → Mock-Erkennung → relPath in violations) gegen ein Temp-Verzeichnis.
// Ein verschobener cwd oder falsch normalisierter relative()-Pfad würde
// sonst still die Exemption oder die Erkennung aushebeln.
describe("scanForMocks — File-Walk-Integration", () => {
  test("allowlistete Datei exempt, neue mock-haltige Datei als Violation, saubere Datei still", () => {
    const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
    const { join } = require("node:path");
    const { tmpdir } = require("node:os");
    const { scanForMocks } = require("../../../integration.guard.js");

    const base = mkdtempSync(join(tmpdir(), "mock-guard-walk-"));
    try {
      const allowlisted = "samples/recipes/auth-claims/src/__tests__";
      mkdirSync(join(base, allowlisted), { recursive: true });
      writeFileSync(
        join(base, allowlisted, "feature.integration.test.ts"),
        'const s = spyOn(logger, "warn");\n',
      );

      mkdirSync(join(base, "samples/foo/__tests__"), { recursive: true });
      writeFileSync(
        join(base, "samples/foo/__tests__/new.integration.test.ts"),
        'spyOn(console, "log");\n',
      );
      writeFileSync(
        join(base, "samples/foo/__tests__/clean.integration.test.ts"),
        "const x = 1;\n",
      );

      const violations = scanForMocks(join(base, "samples"), base);
      expect(violations).toEqual(["samples/foo/__tests__/new.integration.test.ts"]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
