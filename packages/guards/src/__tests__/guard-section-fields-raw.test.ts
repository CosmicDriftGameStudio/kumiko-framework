import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { scanRawSectionFieldReads } from "../guard-section-fields-raw";

const DIR = `${process.cwd()}/packages/framework/src/engine`;

function sourceFile(code: string, name = "reader.ts"): SourceFile {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile(`${DIR}/${name}`, code);
}

const SECTION_DECL =
  "declare const section: { fields: { field: string }[]; groups?: unknown[] };\n";

describe("Raw section.fields Guard", () => {
  // The literal line from e2e-generator.ts:252 before kumiko-framework#3042 —
  // the counter-check that this guard would have caught that regression.
  test("flags the pre-#3042 raw for-of", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(`${SECTION_DECL}for (const rawField of section.fields) { void rawField; }`),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.snippet).toBe("section.fields");
  });

  test("flags an array read over section.fields", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(`${SECTION_DECL}export const names = section.fields.map((f) => f.field);`),
    );
    expect(findings).toHaveLength(1);
  });

  test("flags a spread of section.fields", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(`${SECTION_DECL}export const all = [...section.fields];`),
    );
    expect(findings).toHaveLength(1);
  });

  test("does not flag sectionFieldSpecs(section)", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(
        `${SECTION_DECL}declare function sectionFieldSpecs(s: unknown): { field: string }[];\n` +
          "for (const spec of sectionFieldSpecs(section)) { void spec; }",
      ),
    );
    expect(findings).toEqual([]);
  });

  test("does not flag a raw read marked with a reasoned ignore tag", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(
        `${SECTION_DECL}// kumiko-lint-ignore section-fields-raw writeForm sections carry no groups\n` +
          "for (const f of section.fields) { void f; }",
      ),
    );
    expect(findings).toEqual([]);
  });

  test("still flags a bare ignore tag without a reason", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(
        `${SECTION_DECL}// kumiko-lint-ignore section-fields-raw\n` +
          "for (const f of section.fields) { void f; }",
      ),
    );
    expect(findings).toHaveLength(1);
  });

  test("does not flag entity.fields, which is a field map and not a section", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(
        "declare const entity: { fields: { field: string }[] };\n" +
          "for (const f of entity.fields) { void f; }",
      ),
    );
    expect(findings).toEqual([]);
  });

  // Known gap, pinned so it stays a decision: the fields-XOR-groups validator
  // itself reads the length, and an emptiness check is not the silent-
  // iteration bug this guard is about.
  test("does not flag section.fields.length", () => {
    const findings = scanRawSectionFieldReads(
      sourceFile(`${SECTION_DECL}export const empty = section.fields.length === 0;`),
    );
    expect(findings).toEqual([]);
  });
});
