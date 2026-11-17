import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Project } from "ts-morph";
import { transformEntityNames } from "../scripts/codemod/entity-name.ts";
import { createTypeAwareProject } from "../scripts/codemod/type-aware-project.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "entity-name");

function projectOf(files: readonly string[]): Project {
  const project = createTypeAwareProject(undefined);
  for (const file of files) project.addSourceFileAtPath(file);
  return project;
}

// Every fixture imports the framework engine; one program for all fixtures, built and checked
// once at load, keeps each test to the transform instead of a multi-second program build.
const FIXTURE_PROJECT = projectOf(
  readdirSync(FIXTURES_DIR, { recursive: true, encoding: "utf-8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join(FIXTURES_DIR, entry)),
);
FIXTURE_PROJECT.getProgram().compilerObject.getTypeChecker();

function runFixture(name: string) {
  const file = join(FIXTURES_DIR, `${name}.input.ts`);
  const results = transformEntityNames(FIXTURE_PROJECT, [file]);
  const result = results.get(resolve(file));
  return {
    input: readFileSync(file, "utf8"),
    expected: readFileSync(join(FIXTURES_DIR, `${name}.expected.ts`), "utf8"),
    result,
  };
}

const FIXTURE_CASES: ReadonlyArray<{
  readonly name: string;
  readonly rewrites: number;
  readonly manual: number;
}> = [
  { name: "same-file", rewrites: 4, manual: 0 },
  { name: "second-name", rewrites: 3, manual: 0 },
  { name: "crud-and-executor", rewrites: 6, manual: 0 },
  { name: "inline-untouched", rewrites: 0, manual: 0 },
  { name: "unresolved", rewrites: 1, manual: 2 },
  { name: "inline-create-entity", rewrites: 16, manual: 0 },
  { name: "name-expression", rewrites: 4, manual: 2 },
  { name: "already-named", rewrites: 7, manual: 0 },
  { name: "resolved-identifier", rewrites: 10, manual: 0 },
  { name: "site-form", rewrites: 4, manual: 0 },
];

describe("entity-name codemod fixtures", () => {
  for (const { name, rewrites, manual } of FIXTURE_CASES) {
    it(`${name}: output matches the expected file`, () => {
      const { expected, result } = runFixture(name);

      expect(result?.output).toBe(expected);
      expect(result?.rewrites ?? []).toHaveLength(rewrites);
      expect(result?.manual ?? []).toHaveLength(manual);
    });

    it(`${name}: a second run on the expected file changes nothing`, () => {
      const file = join(FIXTURES_DIR, `${name}.expected.ts`);
      const results = transformEntityNames(FIXTURE_PROJECT, [file]);
      const second = results.get(resolve(file));

      expect(second?.output).toBe(readFileSync(file, "utf8"));
      expect(second?.rewrites ?? []).toHaveLength(0);
      expect(second?.manual ?? []).toHaveLength(manual);
    });
  }
});

describe("entity-name codemod across files", () => {
  const dir = join(FIXTURES_DIR, "cross-file-entity");
  const entityFile = join(dir, "entity.ts");
  const featureFile = join(dir, "feature.ts");

  it("writes the name into the entity file and drops it at the use in another file", () => {
    const results = transformEntityNames(FIXTURE_PROJECT, [entityFile, featureFile]);

    expect(results.get(resolve(entityFile))?.output).toBe(
      readFileSync(join(dir, "expected", "entity.ts"), "utf8"),
    );
    expect(results.get(resolve(featureFile))?.output).toBe(
      readFileSync(join(dir, "expected", "feature.ts"), "utf8"),
    );
  });

  it("reports the unresolved cases with the reason", () => {
    const { result } = runFixture("unresolved");
    const reasons = (result?.manual ?? []).map((site) => site.description);

    expect(reasons).toHaveLength(2);
    for (const reason of reasons) expect(reason).toContain("name is not a string literal");
  });
});
