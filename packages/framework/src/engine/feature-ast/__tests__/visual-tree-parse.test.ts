// AST round-trip tests for the Visual-Tree patterns. Each test feeds
// a minimal inline-feature into parseSourceFile and asserts the
// extracted Pattern shape + the editability classification.
//
// Why split from visual-tree-patterns.test.ts (engine-level): that suite
// covers the registrar+registry runtime path. This suite covers the
// AST extractor + the Designer/AI consumers (renderPattern,
// getEditability, PATTERN_LIBRARY). Both halves must agree on shape.

import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { parseSourceFile } from "../parse";
import { getEditability } from "../patterns";
import { renderPattern } from "../render";

function parseInline(source: string) {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile("feature.ts", source);
  return parseSourceFile(sourceFile);
}

describe("parseSourceFile — r.treeActions extraction", () => {
  test("extracts a static treeActions pattern from an inline action-map", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("text-content", (r) => {
        r.treeActions({
          edit: { args: { slug: "" as string } },
          list: {},
        });
      });
    `);

    expect(result.errors).toEqual([]);
    const treeActions = result.patterns.find((p) => p.kind === "treeActions");
    expect(treeActions).toBeDefined();
    expect(treeActions?.kind).toBe("treeActions");
    if (treeActions?.kind === "treeActions") {
      expect(treeActions.definitions).toEqual({
        edit: { args: { slug: "" } },
        list: {},
      });
    }
  });

  test("treeActions pattern is classified as static (Designer renders form)", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("x", (r) => { r.treeActions({ list: {} }); });
    `);
    const treeActions = result.patterns.find((p) => p.kind === "treeActions");
    expect(treeActions).toBeDefined();
    if (treeActions !== undefined) {
      expect(getEditability(treeActions)).toBe("static");
    }
  });

  test("missing first argument produces a parse-error, not a pattern", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("x", (r) => { r.treeActions(); });
    `);
    expect(result.patterns.find((p) => p.kind === "treeActions")).toBeUndefined();
    expect(result.errors.some((e) => e.methodName === "treeActions")).toBe(true);
  });

  test("non-object first argument (identifier ref) produces a parse-error", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      const actions = { list: {} };
      defineFeature("x", (r) => { r.treeActions(actions); });
    `);
    expect(result.patterns.find((p) => p.kind === "treeActions")).toBeUndefined();
    expect(result.errors.some((e) => e.methodName === "treeActions")).toBe(true);
  });

  test("renderPattern round-trips back to a valid r.treeActions(...) call", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("x", (r) => {
        r.treeActions({ edit: { args: { slug: "" } }, list: {} });
      });
    `);
    const treeActions = result.patterns.find((p) => p.kind === "treeActions");
    expect(treeActions).toBeDefined();
    if (treeActions !== undefined) {
      const rendered = renderPattern(treeActions);
      expect(rendered).toMatch(/^r\.treeActions\(/);
      // renderValue darf identifier-safe Keys unquoted ausgeben — beide
      // Schreibweisen sind valide TypeScript-Source.
      expect(rendered).toMatch(/(["])edit\1|edit\s*:/);
      expect(rendered).toMatch(/(["])slug\1|slug\s*:/);
    }
  });
});

describe("parseSourceFile — r.tree extraction", () => {
  test("extracts an opaque tree pattern with the provider body as SourceLocation", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("text-content", (r) => {
        r.tree((ctx) => (emit) => {
          emit([{ label: "Marketing" }]);
          return () => {};
        });
      });
    `);

    expect(result.errors).toEqual([]);
    const tree = result.patterns.find((p) => p.kind === "tree");
    expect(tree).toBeDefined();
    if (tree?.kind === "tree") {
      expect(tree.providerBody.raw).toContain("emit");
      expect(tree.providerBody.raw).toContain("Marketing");
    }
  });

  test("tree pattern is classified as opaque (Designer renders read-only code-block)", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("x", (r) => { r.tree((ctx) => (emit) => () => {}); });
    `);
    const tree = result.patterns.find((p) => p.kind === "tree");
    expect(tree).toBeDefined();
    if (tree !== undefined) {
      expect(getEditability(tree)).toBe("opaque");
    }
  });

  test("missing first argument produces a parse-error, not a pattern", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("x", (r) => { r.tree(); });
    `);
    expect(result.patterns.find((p) => p.kind === "tree")).toBeUndefined();
    expect(result.errors.some((e) => e.methodName === "tree")).toBe(true);
  });

  test("non-function first argument (identifier ref) produces a parse-error", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      const provider = (ctx: unknown) => (emit: unknown) => () => {};
      defineFeature("x", (r) => { r.tree(provider); });
    `);
    expect(result.patterns.find((p) => p.kind === "tree")).toBeUndefined();
    expect(result.errors.some((e) => e.methodName === "tree")).toBe(true);
  });

  test("renderPattern round-trips back to a valid r.tree(...) call with the body verbatim", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("x", (r) => {
        r.tree((ctx) => (emit) => { emit([]); return () => {}; });
      });
    `);
    const tree = result.patterns.find((p) => p.kind === "tree");
    expect(tree).toBeDefined();
    if (tree !== undefined) {
      const rendered = renderPattern(tree);
      expect(rendered).toMatch(/^r\.tree\(/);
      expect(rendered).toContain("emit");
    }
  });
});

describe("Combined — feature with both r.treeActions and r.tree", () => {
  test("both patterns coexist in the parse output, source-order preserved", () => {
    const result = parseInline(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      defineFeature("text-content", (r) => {
        r.treeActions({ edit: { args: { slug: "" } } });
        r.tree((ctx) => (emit) => { emit([{ label: "Marketing" }]); return () => {}; });
      });
    `);

    expect(result.errors).toEqual([]);
    const kinds = result.patterns.map((p) => p.kind);
    const idxActions = kinds.indexOf("treeActions");
    const idxTree = kinds.indexOf("tree");
    expect(idxActions).toBeGreaterThanOrEqual(0);
    expect(idxTree).toBeGreaterThanOrEqual(0);
    expect(idxActions).toBeLessThan(idxTree);
  });
});
