import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformRegistrarSingleFormSource } from "../scripts/codemod/registrar-single-form.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "registrar-single-form");

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
  { name: "registrar-verbs", rewrites: 13, manual: 0 },
  { name: "apply-extension", rewrites: 4, manual: 0 },
  { name: "manual", rewrites: 0, manual: 6 },
];

describe("registrar-single-form codemod fixtures", () => {
  for (const { name, rewrites, manual } of FIXTURE_CASES) {
    it(`${name}: output matches the expected file`, () => {
      const { input, expected } = readFixture(name);
      const result = transformRegistrarSingleFormSource(input, `${name}.ts`);

      expect(result.output).toBe(expected);
      expect(result.rewrites).toHaveLength(rewrites);
      expect(result.manual).toHaveLength(manual);
    });

    it(`${name}: a second run on the expected file changes nothing`, () => {
      const { expected } = readFixture(name);
      const second = transformRegistrarSingleFormSource(expected, `${name}.ts`);

      expect(second.output).toBe(expected);
      expect(second.rewrites).toHaveLength(0);
      expect(second.manual).toHaveLength(manual);
    });
  }
});

describe("registrar-single-form codemod behavior", () => {
  it("removes the useHookAtTopLevel biome-ignore above a rewritten useExtension", () => {
    const { input, expected } = readFixture("apply-extension");

    expect(input).toContain("biome-ignore lint/correctness/useHookAtTopLevel");
    expect(expected).not.toContain("biome-ignore");
  });

  it("reports spread, missing, non-identifier, ambiguous and unresolved sites as manual", () => {
    const { input } = readFixture("manual");
    const result = transformRegistrarSingleFormSource(input, "manual.ts");

    expect(result.manual.map((site) => site.line)).toEqual([4, 5, 6, 7, 8, 13]);
    const reasons = result.manual.map((site) => site.description);
    expect(reasons[0]).toContain("spread argument");
    expect(reasons[1]).toContain("missing argument");
    expect(reasons[2]).toContain("not an identifier");
    expect(reasons[3]).toContain("missing argument");
    expect(reasons[4]).toContain("may already be the options object");
    expect(reasons[5]).toContain("not a resolvable FeatureRegistrar");
  });

  it("rewrites a nested registrar call inside another rewritten call exactly once", () => {
    const result = transformRegistrarSingleFormSource(
      [
        'defineFeature("x", (r) => {',
        '  r.job("a", { trigger }, () => {',
        '    r.metric("m", { kind: "counter" });',
        "  });",
        "});",
        "",
      ].join("\n"),
      "nested.ts",
    );

    expect(result.rewrites).toHaveLength(2);
    expect(result.output).toContain('r.metric({ name: "m", kind: "counter" });');
    expect(result.output).not.toContain('r.metric("m"');
  });
});
