// Runtime-validator tests for parsePatternChanges (kumiko-framework#3137).
// The round-trip guard is the load-bearing test: every FeaturePattern the
// real-feature/recipe corpus produces must survive an add-change parse
// byte-for-byte, or the schema has drifted from patterns.ts.

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import type { z } from "zod";
import { parseFeatureFile, parseSourceFile } from "../parse";
import { applyChanges, type PatternId } from "../patch";
import {
  type PATTERN_ID_SCHEMAS_BY_KIND,
  type PATTERN_SCHEMAS_BY_KIND,
  parsePatternChanges,
} from "../pattern-change-schema";
import type { FeaturePattern, FeaturePatternKind } from "../patterns";

// Compile-time guard (AC5): every pattern/patternId schema's z.output must
// have exactly the same keys as, and be assignable to, the domain type it
// stands for. `keyof` ignores readonly, so readonly fields on FeaturePattern
// are not an obstacle here; only tsc checks this (bun strips types at
// runtime). A mapped type computes its value per key independently; a plain
// value-level assignment to `Record<Kind, true>` then forces tsc to report
// the exact offending kind if any value there is `false` (wrapping this in a
// generic `Expect<T extends true>` check instead loses per-key narrowing and
// only ever reports "boolean is not assignable to true" with no key name).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type PatternSchemaKeysMatch = {
  [K in FeaturePatternKind]: Equal<
    keyof z.output<(typeof PATTERN_SCHEMAS_BY_KIND)[K]>,
    keyof Extract<FeaturePattern, { kind: K }>
  >;
};
type PatternSchemaAssignable = {
  [K in FeaturePatternKind]: z.output<(typeof PATTERN_SCHEMAS_BY_KIND)[K]> extends Extract<
    FeaturePattern,
    { kind: K }
  >
    ? true
    : false;
};
export const _patternSchemaKeysMatch: Record<FeaturePatternKind, true> =
  null as unknown as PatternSchemaKeysMatch;
export const _patternSchemaAssignable: Record<FeaturePatternKind, true> =
  null as unknown as PatternSchemaAssignable;

type PatternIdSchemaKeysMatch = {
  [K in PatternId["kind"]]: Equal<
    keyof z.output<(typeof PATTERN_ID_SCHEMAS_BY_KIND)[K]>,
    keyof Extract<PatternId, { kind: K }>
  >;
};
type PatternIdSchemaAssignable = {
  [K in PatternId["kind"]]: z.output<(typeof PATTERN_ID_SCHEMAS_BY_KIND)[K]> extends Extract<
    PatternId,
    { kind: K }
  >
    ? true
    : false;
};
export const _patternIdSchemaKeysMatch: Record<PatternId["kind"], true> =
  null as unknown as PatternIdSchemaKeysMatch;
export const _patternIdSchemaAssignable: Record<PatternId["kind"], true> =
  null as unknown as PatternIdSchemaAssignable;

const REPO_ROOT = resolve(__dirname, "../../../../../..");

const REAL_FEATURE_PATHS: readonly string[] = [
  "packages/bundled-features/src/tenant/feature.ts",
  "packages/bundled-features/src/audit/feature.ts",
  "packages/bundled-features/src/sessions/feature.ts",
  "packages/bundled-features/src/auth-email-password/feature.ts",
];

function collectRecipeFeaturePaths(): readonly string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const matches = project
    .addSourceFilesAtPaths(resolve(REPO_ROOT, "samples/recipes/**/src/feature.ts"))
    .map((sf) => sf.getFilePath());
  return matches;
}

describe("parsePatternChanges — round-trip guard against real features", () => {
  const allPaths = [
    ...REAL_FEATURE_PATHS.map((p) => resolve(REPO_ROOT, p)),
    ...collectRecipeFeaturePaths(),
  ];

  for (const path of allPaths) {
    test(`every parsed pattern in ${path.replace(`${REPO_ROOT}/`, "")} round-trips through parsePatternChanges`, () => {
      const result = parseFeatureFile(path);
      for (const pattern of result.patterns) {
        const parsed = parsePatternChanges([{ op: "add", pattern }]);
        if (!parsed.ok) {
          throw new Error(
            `pattern kind=${pattern.kind} failed to round-trip: ${JSON.stringify(parsed.issues)}\n` +
              `pattern: ${JSON.stringify(pattern)}`,
          );
        }
        expect(parsed.changes).toEqual([{ op: "add", pattern }]);
      }
    });
  }
});

describe("parsePatternChanges — structural validation", () => {
  test("non-array input is rejected with path 'changes'", () => {
    const result = parsePatternChanges({ not: "an array" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([{ path: "changes", message: "must be an array" }]);
  });

  test("nested access under a stray `definition` key is rejected with the exact contract path", () => {
    const result = parsePatternChanges([
      {
        op: "replace",
        id: { kind: "writeHandler", handlerName: "customer:delete" },
        pattern: {
          kind: "writeHandler",
          handlerName: "customer:delete",
          schemaSource: "z.object({})",
          handlerBody: "async () => {}",
          definition: { access: { roles: ["TenantAdmin"] } },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: "changes[0].pattern.definition.access",
      message: "unexpected key; access belongs at top level of the pattern",
    });
  });

  test("a stray `definition.access` on a kind without top-level access gets the plain unexpected-key issue", () => {
    const result = parsePatternChanges([
      {
        op: "add",
        pattern: {
          kind: "hook",
          hookType: "postSave",
          target: "customer:create",
          fnBody: "async () => {}",
          definition: { access: { roles: ["TenantAdmin"] } },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: "changes[0].pattern.definition", message: "unexpected key" },
    ]);
  });

  test("F11-form partial replace (access only, no schema/handler body) is rejected at both paths", () => {
    const result = parsePatternChanges([
      {
        op: "replace",
        id: { kind: "writeHandler", handlerName: "customer:delete" },
        pattern: {
          kind: "writeHandler",
          handlerName: "customer:delete",
          access: { roles: ["TenantAdmin"] },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain("changes[0].pattern.schemaSource");
    expect(paths).toContain("changes[0].pattern.handlerBody");
  });

  test("malformed access rules are rejected", () => {
    const base = {
      kind: "writeHandler" as const,
      handlerName: "x",
      schemaSource: "z.object({})",
      handlerBody: "async () => {}",
    };
    const whitespaceReason = parsePatternChanges([
      { op: "add", pattern: { ...base, access: { openToAll: { reason: "  " } } } },
    ]);
    expect(whitespaceReason.ok).toBe(false);
    if (!whitespaceReason.ok) {
      expect(whitespaceReason.issues).toContainEqual(
        expect.objectContaining({ path: "changes[0].pattern.access.openToAll.reason" }),
      );
    }

    const wrongRolesType = parsePatternChanges([
      { op: "add", pattern: { ...base, access: { roles: "Admin" } } },
    ]);
    expect(wrongRolesType.ok).toBe(false);
    if (!wrongRolesType.ok) {
      expect(
        wrongRolesType.issues.some((i) => i.path.startsWith("changes[0].pattern.access")),
      ).toBe(true);
    }

    const extraKey = parsePatternChanges([
      { op: "add", pattern: { ...base, access: { roles: ["Admin"], extra: true } } },
    ]);
    expect(extraKey.ok).toBe(false);
    if (!extraKey.ok) {
      expect(extraKey.issues).toContainEqual(
        expect.objectContaining({ path: "changes[0].pattern.access" }),
      );
    }
  });

  test("entity field-type validation reports the exact path", () => {
    const result = parsePatternChanges([
      {
        op: "add",
        pattern: {
          kind: "entity",
          entityName: "invoice",
          definition: { fields: { payload: { type: "json" } } },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "changes[0].pattern.definition.fields.payload.type" }),
    );
  });

  test("an opaque handler reference with a set header key is rejected (header would be silently dropped)", () => {
    const result = parsePatternChanges([
      {
        op: "add",
        pattern: {
          kind: "writeHandler",
          source: "someRef",
          access: { roles: ["Admin"] },
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "changes[0].pattern.access" }),
    );
  });

  test("id.kind / pattern.kind mismatch is rejected", () => {
    const result = parsePatternChanges([
      {
        op: "replace",
        id: { kind: "metric", shortName: "created_total" },
        pattern: { kind: "secret", shortName: "created_total", options: {} },
      },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "changes[0].pattern.kind" }),
    );
  });

  test("unknown op is rejected", () => {
    const result = parsePatternChanges([{ op: "upsert", pattern: { kind: "systemScope" } }]);
    expect(result.ok).toBe(false);
  });

  test("uiHints/unknown patterns without a non-empty source.raw are rejected", () => {
    const uiHints = parsePatternChanges([{ op: "add", pattern: { kind: "uiHints", source: "" } }]);
    expect(uiHints.ok).toBe(false);

    const unknownKind = parsePatternChanges([
      { op: "add", pattern: { kind: "unknown", methodName: "r.somethingNew", source: "" } },
    ]);
    expect(unknownKind.ok).toBe(false);
  });

  test("rationale is accepted on the wire and dropped from the parsed output", () => {
    const result = parsePatternChanges([
      {
        op: "add",
        rationale: "operator asked for this",
        pattern: { kind: "systemScope" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes[0]).toEqual({
      op: "add",
      pattern: { kind: "systemScope", source: expect.any(Object) },
    });
    expect(result.changes[0]).not.toHaveProperty("rationale");
  });
});

describe("parsePatternChanges — extractEntity uses the same field-type catalogue", () => {
  const STARTER = (fieldExpr: string) => `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("billing", (r) => {
  r.entity("invoice", { fields: { payload: ${fieldExpr} } });
});
`;

  let fileCounter = 0;
  function makeSourceFile(content: string): SourceFile {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true,
    });
    fileCounter += 1;
    return project.createSourceFile(`f-${fileCounter}.ts`, content);
  }

  test("unknown field type produces a ParseError with the expected message", () => {
    const result = parseSourceFile(makeSourceFile(STARTER('{ type: "json" }')));
    const error = result.errors.find((e) => e.methodName === "entity");
    expect(error).toBeDefined();
    expect(error?.reason).toContain('definition.fields.payload.type: unknown field type "json"');
  });

  test("unknown field type in object-form r.entity(...) also produces a ParseError", () => {
    const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("billing", (r) => {
  r.entity({ name: "invoice", fields: { payload: { type: "json" } } });
});
`;
    const result = parseSourceFile(makeSourceFile(source));
    const error = result.errors.find((e) => e.methodName === "entity");
    expect(error).toBeDefined();
    expect(error?.reason).toContain('definition.fields.payload.type: unknown field type "json"');
  });

  test("a real field type (jsonb) does not error", () => {
    const result = parseSourceFile(makeSourceFile(STARTER('{ type: "jsonb" }')));
    expect(result.errors.find((e) => e.methodName === "entity")).toBeUndefined();
  });

  test("an unresolvable identifier field-type sentinel does not error and still extracts the entity", () => {
    const source = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { SOME_TYPE } from "./somewhere";

defineFeature("billing", (r) => {
  r.entity("invoice", { fields: { payload: { type: SOME_TYPE } } });
});
`;
    const result = parseSourceFile(makeSourceFile(source));
    expect(result.errors.find((e) => e.methodName === "entity")).toBeUndefined();
    const entity = result.patterns.find(
      (p): p is Extract<FeaturePattern, { kind: "entity" }> => p.kind === "entity",
    );
    expect(entity).toBeDefined();
    expect(entity?.entityName).toBe("invoice");
  });
});

describe("parsePatternChanges — applyChanges integration for opaque bodies", () => {
  const STARTER = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
});
`;

  let fileCounter = 0;
  function makeSourceFile(content: string): SourceFile {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true,
    });
    fileCounter += 1;
    return project.createSourceFile(`f-${fileCounter}.ts`, content);
  }

  test("string-form bodies re-parse with identical handlerName/access/raw text", () => {
    const parsed = parsePatternChanges([
      {
        op: "add",
        pattern: {
          kind: "writeHandler",
          handlerName: "task:create",
          access: { roles: ["Admin"] },
          schemaSource: "z.object({ title: z.string() })",
          handlerBody: "async (event, ctx) => { return { ok: true }; }",
        },
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const sf = makeSourceFile(STARTER);
    applyChanges(sf, parsed.changes);
    const reparsed = parseSourceFile(sf);
    const handler = reparsed.patterns.find(
      (p): p is Extract<FeaturePattern, { kind: "writeHandler" }> => p.kind === "writeHandler",
    );
    expect(handler?.handlerName).toBe("task:create");
    expect(handler?.access).toEqual({ roles: ["Admin"] });
    expect(handler?.schemaSource?.raw).toBe("z.object({ title: z.string() })");
    expect(handler?.handlerBody?.raw).toBe("async (event, ctx) => { return { ok: true }; }");
  });

  test("{raw} object-form bodies re-parse with identical handlerName/access/raw text", () => {
    const parsed = parsePatternChanges([
      {
        op: "add",
        pattern: {
          kind: "writeHandler",
          handlerName: "task:archive",
          access: { openToAll: { reason: "internal tool" } },
          schemaSource: { raw: "z.object({ id: z.string() })" },
          handlerBody: { raw: "async (event, ctx) => { return { ok: true }; }" },
        },
      },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const sf = makeSourceFile(STARTER);
    applyChanges(sf, parsed.changes);
    const reparsed = parseSourceFile(sf);
    const handler = reparsed.patterns.find(
      (p): p is Extract<FeaturePattern, { kind: "writeHandler" }> => p.kind === "writeHandler",
    );
    expect(handler?.handlerName).toBe("task:archive");
    expect(handler?.access).toEqual({ openToAll: { reason: "internal tool" } });
    expect(handler?.schemaSource?.raw).toBe("z.object({ id: z.string() })");
    expect(handler?.handlerBody?.raw).toBe("async (event, ctx) => { return { ok: true }; }");
  });
});
