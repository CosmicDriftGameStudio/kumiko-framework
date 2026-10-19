import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { findPositionalRegistrarCalls, guard } from "../guard-api-object-form";

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

const FEATURE_PATH = "/r/packages/bundled-features/src/foo/feature.ts";

function inFeature(body: string): SourceFile[] {
  return files({ [FEATURE_PATH]: `defineFeature("foo", (r) => {\n${body}\n});` });
}

describe("findPositionalRegistrarCalls", () => {
  const positional: Record<string, string> = {
    writeHandler: 'r.writeHandler("a", schema, handler, { access });',
    queryHandler: 'r.queryHandler("a", schema, handler, { access });',
    entity: 'r.entity("a", def);',
    requires: 'r.requires("users");',
    hook: 'r.hook("postSave", target, fn);',
  };

  for (const [method, call] of Object.entries(positional)) {
    test(`flags a positional r.${method}`, () => {
      const findings = findPositionalRegistrarCalls(inFeature(call));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain(`positional r.${method}(…) removed in 0.366`);
      expect(findings[0]?.message).toContain("kumiko-upgrade --apply");
    });
  }

  test("flags the registerEntityCrud import and call", () => {
    const sfs = files({
      [FEATURE_PATH]: [
        'import { registerEntityCrud } from "@cosmicdrift/kumiko-framework/engine";',
        'defineFeature("foo", (r) => {',
        '  registerEntityCrud(r, "note", noteEntity);',
        "});",
      ].join("\n"),
    });

    const findings = findPositionalRegistrarCalls(sfs);

    expect(findings.map((f) => f.line).sort()).toEqual([1, 3]);
    expect(findings[0]?.message).toContain("use r.crud");
  });

  test("flags an aliased registerEntityCrud call", () => {
    const sfs = files({
      [FEATURE_PATH]: [
        'import { registerEntityCrud as crud } from "../engine";',
        'export const setup = (r: FeatureRegistrar) => crud(r, "note", noteEntity);',
      ].join("\n"),
    });

    expect(
      findPositionalRegistrarCalls(sfs)
        .map((f) => f.line)
        .sort(),
    ).toEqual([1, 2]);
  });

  test("flags a FeatureRegistrar-typed helper parameter", () => {
    const sfs = files({
      [FEATURE_PATH]:
        'export function setup(registrar: FeatureRegistrar<"x">) { registrar.entity("a", def); }',
    });

    expect(findPositionalRegistrarCalls(sfs)).toHaveLength(1);
  });

  test("flags a positional call whose member access is broken across lines", () => {
    const sfs = files({
      [FEATURE_PATH]: 'export const setup = (r: FeatureRegistrar) => r\n  .\n  entity("a", def);',
    });

    expect(findPositionalRegistrarCalls(sfs)).toHaveLength(1);
  });

  test("flags an unresolvable receiver named r", () => {
    const sfs = files({ [FEATURE_PATH]: 'const r = createRegistrar();\nr.requires("users");' });

    expect(findPositionalRegistrarCalls(sfs)).toHaveLength(1);
  });

  test("flags positional calls in test files too", () => {
    const sfs = files({
      "/r/packages/bundled-features/src/foo/feature.test.ts": [
        'defineFeature("foo", (r) => {',
        '  r.requires("users");',
        "});",
      ].join("\n"),
    });

    expect(findPositionalRegistrarCalls(sfs)).toHaveLength(1);
  });

  describe("does not flag", () => {
    test("the object form", () => {
      const findings = findPositionalRegistrarCalls(
        inFeature(
          [
            'r.writeHandler({ name: "a", schema, handler, access });',
            'r.queryHandler({ name: "a", schema, handler, access });',
            'r.entity({ name: "a", fields: {} });',
            'r.requires({ features: ["users"] });',
            'r.hook({ type: "postSave", target, handler: fn });',
            'r.crud("note", noteEntity);',
          ].join("\n"),
        ),
      );

      expect(findings).toEqual([]);
    });

    test("receivers that are not a registrar", () => {
      const findings = findPositionalRegistrarCalls(
        files({
          [FEATURE_PATH]: [
            'sessions.requires("x");',
            'foo.entity("a", b);',
            'function other(r: Router) { r.hook("get", "/x", handler); }',
          ].join("\n"),
        }),
      );

      expect(findings).toEqual([]);
    });

    test("r.requires.projection and r.optionalRequires", () => {
      const findings = findPositionalRegistrarCalls(
        inFeature('r.requires.projection("t");\nr.optionalRequires("billing");'),
      );

      expect(findings).toEqual([]);
    });

    test("a file under __tests__/fixtures", () => {
      const sfs = files({
        "/r/packages/framework/src/__tests__/fixtures/object-form/a.input.ts":
          'defineFeature("foo", (r) => { r.requires("users"); });',
      });

      expect(findPositionalRegistrarCalls(sfs)).toEqual([]);
    });

    test("a declaration file", () => {
      const sfs = files({
        "/r/packages/framework/src/types.d.ts":
          'declare const r: FeatureRegistrar; r.requires("x");',
      });

      expect(findPositionalRegistrarCalls(sfs)).toEqual([]);
    });
  });
});

describe("guard.run", () => {
  test("reports each finding as a violation without a security flag", () => {
    const outcome = guard.run(inFeature('r.requires("users");'));

    expect(outcome.violations).toHaveLength(1);
    expect(guard.security).toBeUndefined();
  });
});

// The guard and the framework codemod keep separate copies of the receiver and positional rules;
// this test is what stops them from drifting apart.
describe("parity with the object-form codemod fixtures", () => {
  const FIXTURES_DIR = path.join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "framework",
    "src",
    "__tests__",
    "fixtures",
    "object-form",
  );
  const CODEMOD_SCRIPT = path.join(
    FIXTURES_DIR,
    "..",
    "..",
    "..",
    "scripts",
    "codemod",
    "object-form.ts",
  );
  const MANUAL_BY_DESIGN = new Set(["manual"]);

  function fixtureNames(): string[] {
    return readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".input.ts"))
      .map((f) => f.replace(".input.ts", ""));
  }

  function guardLines(source: string): Set<number> {
    const sfs = files({ "/r/packages/bundled-features/src/foo/fixture.ts": source });
    return new Set(findPositionalRegistrarCalls(sfs).map((f) => f.line));
  }

  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), "object-form-parity-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  async function rewrittenLines(fixture: string, source: string): Promise<number[]> {
    // A copy outside __tests__/fixtures: the codemod skips that path by design.
    const copy = path.join(workDir, `${fixture}.ts`);
    writeFileSync(copy, source);
    const proc = Bun.spawn({
      cmd: ["bun", CODEMOD_SCRIPT, copy, "--dry-run", "--no-format"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    return [...stdout.matchAll(/:(\d+) {2}\w+ {2}rewritten$/gm)].map((m) => Number(m[1]));
  }

  // Mirrors FIXTURE_CASES in the framework's object-form-codemod.test.ts; a codemod that
  // crashes or finds nothing must not let the parity assertions pass vacuously.
  const REWRITE_COUNTS: Record<string, number> = {
    "write-handler": 4,
    "query-handler": 2,
    entity: 6,
    requires: 5,
    hook: 8,
    crud: 2,
    "crud-shared-import": 1,
    "registrar-typed-helper": 3,
    "not-a-registrar": 0,
    "already-object-form": 0,
    manual: 0,
  };

  test("every fixture has a registered rewrite count", () => {
    expect(fixtureNames().sort()).toEqual(Object.keys(REWRITE_COUNTS).sort());
  });

  test("the fixtures directory has cases", () => {
    expect(fixtureNames().length).toBeGreaterThan(5);
  });

  for (const name of fixtureNames()) {
    test(`${name}: every site the codemod rewrites is flagged`, async () => {
      const source = readFileSync(path.join(FIXTURES_DIR, `${name}.input.ts`), "utf8");
      const flagged = guardLines(source);
      const rewritten = await rewrittenLines(name, source);

      expect(rewritten).toHaveLength(REWRITE_COUNTS[name] ?? -1);
      for (const line of rewritten) {
        expect(flagged.has(line)).toBe(true);
      }
    });

    if (MANUAL_BY_DESIGN.has(name)) continue;
    test(`${name}: the rewritten output has no finding left`, () => {
      const expected = readFileSync(path.join(FIXTURES_DIR, `${name}.expected.ts`), "utf8");

      expect([...guardLines(expected)]).toEqual([]);
    });
  }
});
