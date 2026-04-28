// Smoke tests for the feature-ast parser. The full per-pattern
// extractor coverage lands with C1.5 (one round per pattern + matching
// test); these tests pin the structural contract that every extractor
// will rely on:
//
//   - parseSourceFile finds the defineFeature call and reads its name
//   - the walker recognises any `<param>.<method>(...)` shape and
//     returns one pattern per call, in source order
//   - the registrar parameter name is read from the setup callback
//     (NOT hardcoded to "r")
//   - files without defineFeature are safe (empty result, no throw)
//
// Until C1.5 lands, every recognised call becomes UnknownPattern with
// the correct methodName. That signal is what the tests check — once
// concrete extractors arrive, the kind assertions sharpen.

import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { parseSourceFile } from "../parse";

function createProject() {
  return new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
}

describe("parseSourceFile", () => {
  test("extracts featureName from defineFeature(name, setup)", () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      "inline.ts",
      `
import { defineFeature } from "@kumiko/framework/engine";
defineFeature("myFeature", (r) => {
  r.entity("task", { fields: { name: { type: "text" } } });
});
`,
    );

    const result = parseSourceFile(sourceFile);

    expect(result.featureName).toBe("myFeature");
  });

  test("returns one pattern per r.* call, in source order", () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      "inline.ts",
      `
defineFeature("foo", (r) => {
  r.entity("task", { fields: {} });
  r.requires("auth");
  r.systemScope();
});
`,
    );

    const result = parseSourceFile(sourceFile);

    expect(result.patterns).toHaveLength(3);
    // Skeleton: every recognised call becomes UnknownPattern with the
    // correct methodName. Replaced by concrete patterns in C1.5.
    expect(result.patterns[0]).toMatchObject({ kind: "unknown", methodName: "entity" });
    expect(result.patterns[1]).toMatchObject({ kind: "unknown", methodName: "requires" });
    expect(result.patterns[2]).toMatchObject({ kind: "unknown", methodName: "systemScope" });
  });

  test("follows the setup callback's parameter name (NOT hardcoded 'r')", () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      "inline.ts",
      `
defineFeature("alt", (registrar) => {
  registrar.entity("task", { fields: {} });
  registrar.requires("auth");
});
`,
    );

    const result = parseSourceFile(sourceFile);

    expect(result.patterns).toHaveLength(2);
    expect(result.patterns[0]?.kind).toBe("unknown");
    expect(result.patterns[1]?.kind).toBe("unknown");
  });

  test("ignores method calls on receivers that aren't the registrar", () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      "inline.ts",
      `
defineFeature("isolated", (r) => {
  const helper = { entity: () => {} };
  helper.entity(); // must not be reported
  console.log("noise"); // must not be reported
  r.entity("task", { fields: {} });
});
`,
    );

    const result = parseSourceFile(sourceFile);

    // Only the actual r.entity call shows up — helper.entity and
    // console.log are filtered out by extractRegistrarMethodName.
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({ kind: "unknown", methodName: "entity" });
  });

  test("returns empty result when no defineFeature is present", () => {
    const project = createProject();
    const sourceFile = project.createSourceFile("plain.ts", "export const x = 1;");

    const result = parseSourceFile(sourceFile);

    expect(result.featureName).toBeUndefined();
    expect(result.patterns).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("attaches a 1-based SourceLocation pointing at the call", () => {
    const project = createProject();
    const sourceFile = project.createSourceFile(
      "inline.ts",
      `defineFeature("loc", (r) => {
  r.entity("task", { fields: {} });
});
`,
    );

    const result = parseSourceFile(sourceFile);

    expect(result.patterns).toHaveLength(1);
    const source = result.patterns[0]?.source;
    expect(source).toBeDefined();
    // The r.entity call sits on line 2 of the snippet (1-based).
    expect(source?.start.line).toBe(2);
    // Raw text round-trips the original call.
    expect(source?.raw).toContain("r.entity");
  });

  test("falls back to UnknownPattern when defineFeature is missing the setup callback", () => {
    const project = createProject();
    const sourceFile = project.createSourceFile("inline.ts", `defineFeature("nameOnly");`);

    const result = parseSourceFile(sourceFile);

    expect(result.featureName).toBe("nameOnly");
    expect(result.patterns).toEqual([]);
  });
});
