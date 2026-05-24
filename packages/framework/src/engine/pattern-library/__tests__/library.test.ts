// Pattern-Library tests:
//   1. Coverage — every FeaturePatternKind has a schema entry.
//   2. Editability — schema's `editability` matches the parser's
//      getEditability() classification (no drift between the two).
//   3. Singleton flags — match the patcher's SINGLETON_KINDS contract.
//   4. Field paths — at least one expected path resolves on a canonical
//      sample pattern (sanity check that entity-fields-editor points at
//      `definition.fields`, not `fields`).

import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  type FeaturePattern,
  type FeaturePatternKind,
  getEditability,
  SINGLETON_KINDS,
} from "../../feature-ast";
import {
  getPatternSchema,
  groupByCategory,
  PATTERN_LIBRARY,
  type PatternFormSchema,
} from "../index";

// All FeaturePatternKind discriminator values, hand-listed so the test
// fails CI when a new pattern is added without a library entry. Match
// against the FeaturePattern union via type-test below.
const ALL_KINDS: readonly FeaturePatternKind[] = [
  "requires",
  "optionalRequires",
  "readsConfig",
  "systemScope",
  "toggleable",
  "entity",
  "relation",
  "nav",
  "workspace",
  "config",
  "translations",
  "metric",
  "secret",
  "claimKey",
  "referenceData",
  "useExtension",
  "screen",
  "writeHandler",
  "queryHandler",
  "hook",
  "entityHook",
  "job",
  "notification",
  "authClaims",
  "httpRoute",
  "projection",
  "multiStreamProjection",
  "defineEvent",
  "eventMigration",
  "extendsRegistrar",
  "usesApi",
  "exposesApi",
  "treeActions",
  "tree",
  "envSchema",
  "unknown",
];

describe("pattern-library coverage", () => {
  test("ALL_KINDS matches the FeaturePatternKind union", () => {
    // Compile-time check that ALL_KINDS is exhaustive — assigning an
    // arbitrary FeaturePatternKind to (typeof ALL_KINDS)[number] only
    // succeeds when the array literal lists every union member.
    expectTypeOf<(typeof ALL_KINDS)[number]>().toEqualTypeOf<FeaturePatternKind>();
  });

  test("PATTERN_LIBRARY has an entry for every kind", () => {
    for (const kind of ALL_KINDS) {
      expect(PATTERN_LIBRARY[kind]).toBeDefined();
      expect(PATTERN_LIBRARY[kind]?.kind).toBe(kind);
    }
  });

  test("getPatternSchema returns the matching schema", () => {
    for (const kind of ALL_KINDS) {
      const schema = getPatternSchema(kind);
      expect(schema.kind).toBe(kind);
    }
  });

  test("each schema has a non-empty label and summary in English", () => {
    for (const schema of Object.values(PATTERN_LIBRARY)) {
      expect(schema.label.en.length).toBeGreaterThan(0);
      expect(schema.summary.en.length).toBeGreaterThan(0);
    }
  });
});

describe("pattern-library — editability matches parser classification", () => {
  // The library declares editability per pattern; the parser's
  // getEditability() classifies an actual pattern. Both must agree
  // for every kind, otherwise the Designer renders a kind as opaque
  // while the parser thinks it's editable, or vice versa.
  test.each(ALL_KINDS)("%s matches parser classification", (kind) => {
    const schema = PATTERN_LIBRARY[kind];
    if (!schema) throw new Error(`missing schema for ${kind}`);
    const placeholderPattern = makePlaceholderPattern(kind);
    expect(schema.editability).toBe(getEditability(placeholderPattern));
  });
});

describe("pattern-library — singleton flags match patcher contract", () => {
  // Imported (not duplicated) from patch.ts — the patcher is the
  // source-of-truth, the library's `singleton: true` flag must follow.
  // If both drifted simultaneously a hand-mirrored set would silently
  // pass; the import enforces a single source.
  test.each(ALL_KINDS)("%s singleton flag matches patcher set", (kind) => {
    const schema = PATTERN_LIBRARY[kind];
    if (!schema) throw new Error(`missing schema for ${kind}`);
    // SINGLETON_KINDS is typed as PatternId["kind"] — the full
    // FeaturePatternKind minus "unknown" (UnknownPattern has no
    // PatternId variant). The cast widens the Set's `has` parameter
    // back to FeaturePatternKind so we can ask about every kind
    // (including "unknown", which always returns false).
    const isPatcherSingleton = (SINGLETON_KINDS as ReadonlySet<FeaturePatternKind>).has(kind);
    const isLibrarySingleton = schema.singleton === true;
    expect(isLibrarySingleton).toBe(isPatcherSingleton);
  });
});

describe("pattern-library — known paths resolve on representative patterns", () => {
  test("entity schema points at definition.fields, not fields", () => {
    const schema = PATTERN_LIBRARY.entity;
    const fieldsField = schema.fields.find((f) => f.path === "definition.fields");
    expect(fieldsField).toBeDefined();
    expect(fieldsField?.input).toBe("entity-fields-editor");
  });

  test("writeHandler schema exposes handlerBody as code-block", () => {
    const schema = PATTERN_LIBRARY.writeHandler;
    const handlerField = schema.fields.find((f) => f.path === "handlerBody");
    expect(handlerField?.input).toBe("code-block");
  });

  test("hook schema declares the discriminated select for hookType", () => {
    const schema = PATTERN_LIBRARY.hook;
    const typeField = schema.fields.find((f) => f.path === "hookType");
    expect(typeField?.input).toBe("select");
  });
});

describe("pattern-library — groupByCategory", () => {
  test("returns every kind exactly once across all categories", () => {
    const groups = groupByCategory();
    const flat = Object.values(groups).flat();
    expect(flat.length).toBe(ALL_KINDS.length);
    const seen = new Set(flat.map((s) => s.kind));
    expect(seen.size).toBe(ALL_KINDS.length);
  });

  test("alphabetises within each category by English label", () => {
    const groups = groupByCategory();
    for (const [_category, schemas] of Object.entries(groups)) {
      const labels = schemas.map((s) => s.label.en);
      const sorted = [...labels].sort((a, b) => a.localeCompare(b));
      expect(labels).toEqual(sorted);
    }
  });
});

// =============================================================================
// Helpers
// =============================================================================

const PLACEHOLDER_LOC = {
  file: "<test>",
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
  raw: "",
} as const;

const PLACEHOLDER_BODY_LOC = { ...PLACEHOLDER_LOC };

/**
 * Build a minimal but valid FeaturePattern of the given kind so we can
 * call getEditability() on it without the parser. Only used for the
 * editability cross-check — values are placeholders.
 */
function makePlaceholderPattern(kind: FeaturePatternKind): FeaturePattern {
  // We avoid `as FeaturePattern` and type-cast each branch via the
  // discriminated union so the test benefits from exhaustiveness too.
  switch (kind) {
    case "requires":
      return { kind, source: PLACEHOLDER_LOC, featureNames: [] };
    case "optionalRequires":
      return { kind, source: PLACEHOLDER_LOC, featureNames: [] };
    case "readsConfig":
      return { kind, source: PLACEHOLDER_LOC, qualifiedKeys: [] };
    case "systemScope":
      return { kind, source: PLACEHOLDER_LOC };
    case "toggleable":
      return { kind, source: PLACEHOLDER_LOC, default: false };
    case "entity":
      return { kind, source: PLACEHOLDER_LOC, entityName: "x", definition: { fields: {} } };
    case "relation":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        entityName: "x",
        relationName: "y",
        definition: { type: "belongsTo", target: "z", foreignKey: "zId" },
      };
    case "nav":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        definition: { id: "x", label: "X" },
      };
    case "workspace":
      return { kind, source: PLACEHOLDER_LOC, definition: { id: "x", label: "X" } };
    case "config":
      return { kind, source: PLACEHOLDER_LOC, keys: {} };
    case "translations":
      return { kind, source: PLACEHOLDER_LOC, keys: {} };
    case "metric":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        shortName: "x",
        options: { type: "counter" },
      };
    case "secret":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        shortName: "x",
        options: { label: { en: "x" }, scope: "tenant" },
      };
    case "claimKey":
      return { kind, source: PLACEHOLDER_LOC, shortName: "x", claimType: "string" };
    case "referenceData":
      return { kind, source: PLACEHOLDER_LOC, entityName: "x", data: [] };
    case "useExtension":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        extensionName: "x",
        entityName: "y",
      };
    case "screen":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        definition: { id: "x", type: "custom", routes: { default: "/x" } } as never,
        opaqueProps: {},
      };
    case "writeHandler":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        handlerName: "x",
        schemaSource: PLACEHOLDER_BODY_LOC,
        handlerBody: PLACEHOLDER_BODY_LOC,
      };
    case "queryHandler":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        handlerName: "x",
        schemaSource: PLACEHOLDER_BODY_LOC,
        handlerBody: PLACEHOLDER_BODY_LOC,
      };
    case "hook":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        hookType: "postSave",
        target: "x",
        fnBody: PLACEHOLDER_BODY_LOC,
      };
    case "entityHook":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        hookType: "postSave",
        entityName: "x",
        fnBody: PLACEHOLDER_BODY_LOC,
      };
    case "job":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        jobName: "x",
        options: { trigger: { type: "schedule", cron: "* * * * *" } } as never,
        handlerBody: PLACEHOLDER_BODY_LOC,
      };
    case "notification":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        notificationName: "x",
        trigger: { on: "y" },
        recipientBody: PLACEHOLDER_BODY_LOC,
        dataBody: PLACEHOLDER_BODY_LOC,
      };
    case "authClaims":
      return { kind, source: PLACEHOLDER_LOC, fnBody: PLACEHOLDER_BODY_LOC };
    case "httpRoute":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        method: "GET",
        path: "/x",
        handlerBody: PLACEHOLDER_BODY_LOC,
      };
    case "projection":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        name: "x",
        sourceEntity: "y",
        applyBodies: {},
      };
    case "multiStreamProjection":
      return { kind, source: PLACEHOLDER_LOC, name: "x", applyBodies: {} };
    case "defineEvent":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        eventName: "x",
        schemaSource: PLACEHOLDER_BODY_LOC,
      };
    case "eventMigration":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        eventName: "x",
        fromVersion: 1,
        toVersion: 2,
        transformBody: PLACEHOLDER_BODY_LOC,
      };
    case "extendsRegistrar":
      return {
        kind,
        source: PLACEHOLDER_LOC,
        extensionName: "x",
        defBody: PLACEHOLDER_BODY_LOC,
      };
    case "treeActions":
      return { kind, source: PLACEHOLDER_LOC, definitions: {} };
    case "tree":
      return { kind, source: PLACEHOLDER_LOC, providerBody: PLACEHOLDER_BODY_LOC };
    case "envSchema":
      return { kind, source: PLACEHOLDER_LOC, schemaBody: PLACEHOLDER_BODY_LOC };
    case "unknown":
      return { kind, source: PLACEHOLDER_LOC, methodName: "x" };
    case "usesApi":
    case "exposesApi":
      return { kind, source: PLACEHOLDER_LOC, apiName: "demo.api" };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

// Avoid unused-var complaint when the type-test imports PatternFormSchema.
void (null as PatternFormSchema | null);
