import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformEscapeHatchGrantsSource } from "../scripts/codemod/escape-hatch-grants.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "escape-hatch-grants");

function readFixture(name: string): { input: string; expected: string } {
  return {
    input: readFileSync(join(FIXTURES_DIR, `${name}.input.ts`), "utf8"),
    expected: readFileSync(join(FIXTURES_DIR, `${name}.expected.ts`), "utf8"),
  };
}

const FIXTURE_CASES: ReadonlyArray<{
  readonly name: string;
  readonly rewrites: number;
  readonly manual: number;
}> = [
  { name: "unsafe-raw", rewrites: 2, manual: 0 },
  { name: "system-identity", rewrites: 4, manual: 0 },
  { name: "global-writes", rewrites: 2, manual: 0 },
  { name: "already-granted", rewrites: 0, manual: 0 },
  { name: "extension-untouched", rewrites: 0, manual: 0 },
  { name: "manual-no-signal", rewrites: 0, manual: 1 },
  { name: "manual-imported", rewrites: 0, manual: 3 },
];

describe("escape-hatch-grants codemod fixtures", () => {
  for (const { name, rewrites, manual } of FIXTURE_CASES) {
    it(`${name}: output matches the expected file`, () => {
      const { input, expected } = readFixture(name);
      const result = transformEscapeHatchGrantsSource(input, `${name}.ts`);

      expect(result.output).toBe(expected);
      expect(result.rewrites).toHaveLength(rewrites);
      expect(result.manual).toHaveLength(manual);
    });

    it(`${name}: a second run on the expected file changes nothing`, () => {
      const { expected } = readFixture(name);
      const second = transformEscapeHatchGrantsSource(expected, `${name}.ts`);

      expect(second.output).toBe(expected);
      expect(second.rewrites).toHaveLength(0);
      expect(second.manual).toHaveLength(manual);
    });
  }
});

describe("escape-hatch-grants codemod behavior", () => {
  it("lists grants in the order of ESCAPE_HATCH_GRANTS", () => {
    const { input } = readFixture("system-identity");
    const result = transformEscapeHatchGrantsSource(input, "system-identity.ts");

    expect(result.rewrites.map((site) => site.description)).toEqual([
      "grants: [systemIdentity]",
      "grants: [systemIdentity, unsafeRaw]",
      "grants: [systemIdentity]",
      "grants: [systemIdentity]",
    ]);
  });

  it("reports a declaration without a readable signal as not inferable", () => {
    const { input } = readFixture("manual-no-signal");
    const result = transformEscapeHatchGrantsSource(input, "manual-no-signal.ts");

    expect(result.output).toBe(input);
    expect(result.manual[0]?.description).toContain("grants not inferable");
  });

  it("reports a handler that passes ctx to an imported helper, even next to a signal", () => {
    const { input } = readFixture("manual-imported");
    const result = transformEscapeHatchGrantsSource(input, "manual-imported.ts");
    const reasons = result.manual.map((site) => site.description);

    expect(reasons[0]).toContain("passes ctx to an imported function");
    expect(reasons[1]).toContain("`importedHandler` is imported");
    expect(reasons[2]).toContain("not an object literal");
  });
});
