// Patch-Operation tests: verify add/replace/remove on a SourceFile-in-
// memory. Strategy: build a minimal feature-file as input, apply the
// change, parse the output, assert structural equivalence to the
// expected pattern set. The test trusts parse + render (both already
// pinned by parse.test.ts + render-roundtrip.test.ts) so a failure
// here narrows the cause to patch.ts itself.

import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { parseSourceFile } from "../parse";
import { addPattern, applyChanges, type PatternId, removePattern, replacePattern } from "../patch";
import { createFeaturePatcher } from "../patcher";
import type { FeaturePattern } from "../patterns";

const STARTER = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.entity({ name: "item", fields: { name: { type: "text", required: true } } });

  r.metric({ name: "created", type: "counter" });
});
`;

function makeSourceFile(content: string): SourceFile {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile(`f-${Math.random()}.ts`, content);
}

const SAMPLE_LOC = {
  file: "x",
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
  raw: "",
};

const newSecretPattern: FeaturePattern = {
  kind: "secret",
  source: SAMPLE_LOC,
  shortName: "stripeKey",
  options: { description: "Stripe API key" } as never,
};

const replacementMetric: FeaturePattern = {
  kind: "metric",
  source: SAMPLE_LOC,
  shortName: "created",
  options: { type: "histogram" } as never,
};

describe("addPattern — appends in canonical Object-Form", () => {
  test("appends a new r.* call at the end of the setup callback", () => {
    const sf = makeSourceFile(STARTER);
    addPattern(sf, newSecretPattern);

    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.patterns.length).toBe(3);

    const lastPattern = reparsed.patterns[2];
    expect(lastPattern?.kind).toBe("secret");
    if (lastPattern?.kind === "secret") {
      expect(lastPattern.shortName).toBe("stripeKey");
    }
  });

  test("appended call is in canonical Object-Form (single object arg)", () => {
    const sf = makeSourceFile(STARTER);
    addPattern(sf, newSecretPattern);
    const text = sf.getFullText();
    expect(text).toMatch(/r\.secret\(\{\s+name:\s*"stripeKey"/);
  });

  test("first add into an empty setup callback", () => {
    const empty = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("blank", (r) => {
});
`;
    const sf = makeSourceFile(empty);
    addPattern(sf, newSecretPattern);
    const reparsed = parseSourceFile(sf);
    expect(reparsed.patterns.length).toBe(1);
    expect(reparsed.patterns[0]?.kind).toBe("secret");
  });
});

describe("replacePattern — substitutes the matching call", () => {
  test("replaces an entity by name with a new entity definition", () => {
    const sf = makeSourceFile(STARTER);
    const id: PatternId = { kind: "entity", entityName: "item" };
    const replacement: FeaturePattern = {
      kind: "entity",
      source: SAMPLE_LOC,
      entityName: "item",
      definition: {
        fields: {
          name: { type: "text", required: true },
          sku: { type: "text" },
        },
      } as never,
    };

    replacePattern(sf, id, replacement);
    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    const entity = reparsed.patterns.find((p) => p.kind === "entity");
    expect(entity).toMatchObject({
      kind: "entity",
      entityName: "item",
    });
    if (entity?.kind === "entity") {
      const fields = (entity.definition as { fields: Record<string, unknown> }).fields;
      expect(Object.keys(fields)).toEqual(["name", "sku"]);
    }
  });

  test("replaces a metric by short name", () => {
    const sf = makeSourceFile(STARTER);
    const id: PatternId = { kind: "metric", shortName: "created" };
    replacePattern(sf, id, replacementMetric);
    const reparsed = parseSourceFile(sf);
    const metric = reparsed.patterns.find((p) => p.kind === "metric");
    expect(metric).toMatchObject({ kind: "metric", shortName: "created" });
    if (metric?.kind === "metric") {
      expect(metric.options).toMatchObject({ type: "histogram" });
    }
  });

  test("throws when no call matches the id", () => {
    const sf = makeSourceFile(STARTER);
    const id: PatternId = { kind: "entity", entityName: "doesNotExist" };
    expect(() =>
      replacePattern(sf, id, {
        ...replacementMetric,
        kind: "entity",
        entityName: "doesNotExist",
        definition: { fields: {} } as never,
      } as FeaturePattern),
    ).toThrow(/no call found/);
  });
});

describe("removePattern — deletes the matching call cleanly", () => {
  test("removes the metric call entirely", () => {
    const sf = makeSourceFile(STARTER);
    const id: PatternId = { kind: "metric", shortName: "created" };
    removePattern(sf, id);
    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.patterns.find((p) => p.kind === "metric")).toBeUndefined();
    expect(reparsed.patterns.length).toBe(1);
  });

  test("add → remove leaves the file with the same patterns as before", () => {
    const sf = makeSourceFile(STARTER);
    const before = parseSourceFile(sf).patterns.map((p) => p.kind);
    addPattern(sf, newSecretPattern);
    removePattern(sf, { kind: "secret", shortName: "stripeKey" });
    const after = parseSourceFile(sf).patterns.map((p) => p.kind);
    expect(after).toEqual(before);
  });

  test("throws when no call matches the id", () => {
    const sf = makeSourceFile(STARTER);
    expect(() => removePattern(sf, { kind: "entity", entityName: "ghost" })).toThrow(
      /no call found/,
    );
  });
});

describe("applyChanges — bulk operations in order", () => {
  test("processes add + replace + remove in order", () => {
    const sf = makeSourceFile(STARTER);
    applyChanges(sf, [
      { op: "add", pattern: newSecretPattern },
      {
        op: "replace",
        id: { kind: "metric", shortName: "created" },
        pattern: replacementMetric,
      },
      { op: "remove", id: { kind: "entity", entityName: "item" } },
    ]);
    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    const kinds = reparsed.patterns.map((p) => p.kind).sort();
    expect(kinds).toEqual(["metric", "secret"]);
    const metric = reparsed.patterns.find((p) => p.kind === "metric");
    if (metric?.kind === "metric") {
      expect(metric.options).toMatchObject({ type: "histogram" });
    }
  });
});

describe("custom-code survival — patches don't disturb non-r.* code", () => {
  test("helpers, comments, imports between calls remain unchanged", () => {
    const featureWithCustomCode = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const SHARED_HELPER = "computed-at-module-init";

defineFeature("inventory", (r) => {
  // Top-of-feature comment — must survive patches.
  const localConst = 42;

  r.entity({ name: "item", fields: { name: { type: "text", required: true } } });

  // Comment between entity and metric — must survive add operations.
  r.metric({ name: "created", type: "counter" });
});

function unrelatedHelper() {
  return SHARED_HELPER;
}
`;
    const sf = makeSourceFile(featureWithCustomCode);
    addPattern(sf, newSecretPattern);
    const text = sf.getFullText();
    expect(text).toContain("// Top-of-feature comment");
    expect(text).toContain("const localConst = 42;");
    expect(text).toContain("// Comment between entity and metric");
    expect(text).toContain("function unrelatedHelper()");
    expect(text).toContain('SHARED_HELPER = "computed-at-module-init"');
  });
});

describe("patch coverage for the remaining pattern-kinds", () => {
  test("add + remove via PatternId for httpRoute (method+path key)", () => {
    const sf = makeSourceFile(STARTER);
    const patcher = createFeaturePatcher(sf);
    patcher.addHttpRoute({
      method: "GET",
      path: "/health",
      handlerSource: "async (c) => c.json({ ok: true })",
    });
    expect(parseSourceFile(sf).patterns).toHaveLength(3);
    removePattern(sf, { kind: "httpRoute", method: "GET", path: "/health" });
    const after = parseSourceFile(sf);
    expect(after.patterns.find((p) => p.kind === "httpRoute")).toBeUndefined();
  });

  test("add + remove via PatternId for projection (name key)", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addProjection({
      name: "summary",
      sourceEntity: "item",
      applySources: { "todo:event:created": "async (event, ctx) => {}" },
    });
    expect(parseSourceFile(sf).patterns.find((p) => p.kind === "projection")).toBeDefined();
    removePattern(sf, { kind: "projection", name: "summary" });
    expect(parseSourceFile(sf).patterns.find((p) => p.kind === "projection")).toBeUndefined();
  });

  test("add + remove via PatternId for multiStreamProjection", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addMultiStreamProjection({
      name: "tenantSummary",
      applySources: { "todo:event:created": "async (event, ctx) => {}" },
    });
    removePattern(sf, { kind: "multiStreamProjection", name: "tenantSummary" });
    expect(
      parseSourceFile(sf).patterns.find((p) => p.kind === "multiStreamProjection"),
    ).toBeUndefined();
  });

  test("add + remove via PatternId for useExtension (name+entity key)", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addUseExtension({ extension: "auditLog", entity: "item" });
    removePattern(sf, {
      kind: "useExtension",
      extensionName: "auditLog",
      entityName: "item",
    });
    expect(parseSourceFile(sf).patterns.find((p) => p.kind === "useExtension")).toBeUndefined();
  });

  test("add + remove via PatternId for notification (name key)", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addNotification({
      name: "itemCreated",
      trigger: { on: "item" },
      recipientSource: "async (event, ctx) => []",
      dataSource: "async (event, ctx) => ({})",
    });
    removePattern(sf, { kind: "notification", notificationName: "itemCreated" });
    expect(parseSourceFile(sf).patterns.find((p) => p.kind === "notification")).toBeUndefined();
  });

  test("add + remove via PatternId for authClaims (singleton key)", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addAuthClaims({
      handlerSource: 'async (user, ctx) => ({ teamId: "t1" })',
    });
    removePattern(sf, { kind: "authClaims" });
    expect(parseSourceFile(sf).patterns.find((p) => p.kind === "authClaims")).toBeUndefined();
  });

  test("add + remove via PatternId for defineEvent with migrations", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addDefineEvent({
      name: "itemCreated",
      schemaSource: "z.object({ id: z.string() })",
      version: 2,
      migrations: { "1": "(old) => old" },
    });
    removePattern(sf, { kind: "defineEvent", eventName: "itemCreated" });
    expect(parseSourceFile(sf).patterns.find((p) => p.kind === "defineEvent")).toBeUndefined();
  });
});

describe("singleton-pattern guards", () => {
  test("findCallForId throws when a singleton-kind appears twice", () => {
    const file = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
defineFeature("dup", (r) => {
  r.systemScope();
  r.systemScope();
});
`;
    const sf = makeSourceFile(file);
    expect(() => removePattern(sf, { kind: "systemScope" })).toThrow(/singleton/);
  });
});

describe("legacy positional → canonical Object-Form on replace", () => {
  test("a positional-form r.entity call is replaced with object-form", () => {
    const legacyFile = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("legacy", (r) => {
  r.entity("item", { fields: { name: { type: "text", required: true } } });
});
`;
    const sf = makeSourceFile(legacyFile);
    const id: PatternId = { kind: "entity", entityName: "item" };
    const replacement: FeaturePattern = {
      kind: "entity",
      source: SAMPLE_LOC,
      entityName: "item",
      definition: {
        fields: { name: { type: "text", required: true }, code: { type: "text" } },
      } as never,
    };
    replacePattern(sf, id, replacement);
    const text = sf.getFullText();
    expect(text).toMatch(/r\.entity\(\{\s+name: "item",/);
    expect(text).not.toContain('r.entity("item"');
  });
});
