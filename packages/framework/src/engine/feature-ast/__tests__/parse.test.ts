// Tests for the feature-ast parser. Two layers:
//
//   1. Structural contract — defineFeature discovery, walker, dynamic
//      registrar param name, source-order, SourceLocation. Every
//      extractor relies on these.
//   2. Per-extractor coverage (C1.5) — one focused test per concrete
//      extractor as it lands.
//
// Methods without an extractor yet still get caught by the dispatcher
// and surfaced as UnknownPattern with the correct methodName, so the
// Designer/AI know the call exists.

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

// Helper: parse an inline source snippet without writing a file.
// Centralised here per the test-setup-centralize feedback rule —
// otherwise every test would repeat the project + sourceFile boilerplate.
function parseInline(source: string) {
  const project = createProject();
  const sourceFile = project.createSourceFile("inline.ts", source);
  return parseSourceFile(sourceFile);
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
    const result = parseInline(`
defineFeature("foo", (r) => {
  r.entity("task", { fields: {} });
  r.requires("auth");
  r.systemScope();
});
`);

    expect(result.patterns).toHaveLength(3);
    expect(result.patterns[0]?.kind).toBe("entity");
    expect(result.patterns[1]?.kind).toBe("requires");
    expect(result.patterns[2]?.kind).toBe("systemScope");
  });

  test("follows the setup callback's parameter name (NOT hardcoded 'r')", () => {
    const result = parseInline(`
defineFeature("alt", (registrar) => {
  registrar.entity("task", { fields: {} });
  registrar.requires("auth");
});
`);

    expect(result.patterns).toHaveLength(2);
    expect(result.patterns[0]?.kind).toBe("entity");
    expect(result.patterns[1]?.kind).toBe("requires");
  });

  test("ignores method calls on receivers that aren't the registrar", () => {
    const result = parseInline(`
defineFeature("isolated", (r) => {
  const helper = { entity: () => {} };
  helper.entity(); // must not be reported
  console.log("noise"); // must not be reported
  r.entity("task", { fields: {} });
});
`);

    // Only the actual r.entity call shows up — helper.entity and
    // console.log are filtered out by extractRegistrarMethodName.
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({ kind: "entity", entityName: "task" });
  });

  test("returns empty result when no defineFeature is present", () => {
    const result = parseInline("export const x = 1;");

    expect(result.featureName).toBeUndefined();
    expect(result.patterns).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("attaches a 1-based SourceLocation pointing at the call", () => {
    const result = parseInline(`defineFeature("loc", (r) => {
  r.entity("task", { fields: {} });
});
`);

    expect(result.patterns).toHaveLength(1);
    const source = result.patterns[0]?.source;
    expect(source).toBeDefined();
    // The r.entity call sits on line 2 of the snippet (1-based).
    expect(source?.start.line).toBe(2);
    // Raw text round-trips the original call.
    expect(source?.raw).toContain("r.entity");
  });

  test("falls back to UnknownPattern when defineFeature is missing the setup callback", () => {
    const result = parseInline(`defineFeature("nameOnly");`);

    expect(result.featureName).toBe("nameOnly");
    expect(result.patterns).toEqual([]);
  });
});

// =============================================================================
// Round 1 extractors — concrete patterns for the simplest static APIs.
// =============================================================================

describe("extractRequires", () => {
  test("captures every string-literal argument as featureNames", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.requires("auth", "tenant");
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "requires",
      featureNames: ["auth", "tenant"],
    });
    expect(result.errors).toEqual([]);
  });

  test("emits a ParseError when an argument is not a string literal", () => {
    const result = parseInline(`
const dep = "auth";
defineFeature("f", (r) => {
  r.requires(dep);
});
`);

    expect(result.patterns).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.methodName).toBe("requires");
  });
});

describe("extractOptionalRequires", () => {
  test("captures featureNames analogous to requires", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.optionalRequires("billing");
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "optionalRequires",
      featureNames: ["billing"],
    });
  });
});

describe("extractReadsConfig", () => {
  test("captures qualifiedKeys", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.readsConfig("auth:config:jwt-ttl", "tenant:config:locale");
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "readsConfig",
      qualifiedKeys: ["auth:config:jwt-ttl", "tenant:config:locale"],
    });
  });
});

describe("extractSystemScope", () => {
  test("produces a SystemScopePattern with no payload", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.systemScope();
});
`);

    expect(result.patterns[0]).toMatchObject({ kind: "systemScope" });
  });
});

describe("extractToggleable", () => {
  test("reads the default flag from a literal object", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.toggleable({ default: true });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "toggleable",
      default: true,
    });
  });

  test("emits a ParseError when the argument is missing", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.toggleable();
});
`);

    expect(result.patterns).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.methodName).toBe("toggleable");
  });

  test("emits a ParseError when default is not a literal boolean", () => {
    const result = parseInline(`
const flag = true;
defineFeature("f", (r) => {
  r.toggleable({ default: flag });
});
`);

    expect(result.patterns).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.methodName).toBe("toggleable");
  });
});

// =============================================================================
// Round 2 extractors — object-literal-based statics
// =============================================================================

describe("extractEntity", () => {
  test("captures entityName + plain-data definition", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.entity("task", {
    fields: {
      title: { type: "text", required: true },
      done: { type: "boolean", default: false },
    },
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "entity",
      entityName: "task",
      definition: {
        fields: {
          title: { type: "text", required: true },
          done: { type: "boolean", default: false },
        },
      },
    });
    expect(result.errors).toEqual([]);
  });

  test("walks through `as const` and `satisfies` wrappers", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.entity("task", { fields: { name: { type: "text" as const } } });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "entity",
      definition: { fields: { name: { type: "text" } } },
    });
  });

  test("emits a ParseError when the definition contains a function value", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.entity("task", {
    fields: {
      title: { type: "text", default: () => "untitled" },
    },
  });
});
`);

    expect(result.patterns).toEqual([]);
    expect(result.errors[0]?.methodName).toBe("entity");
  });

  test("emits a ParseError when the name is not a string literal", () => {
    const result = parseInline(`
const ENTITY = "task";
defineFeature("f", (r) => {
  r.entity(ENTITY, { fields: {} });
});
`);

    expect(result.errors[0]?.methodName).toBe("entity");
  });
});

describe("extractRelation", () => {
  test("reads entity ref + relation name + plain-data definition", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.relation("task", "owner", { kind: "belongsTo", to: "user" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "relation",
      entityName: "task",
      relationName: "owner",
      definition: { kind: "belongsTo", to: "user" },
    });
  });

  test("accepts inline { name: '...' } literal as entity ref", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.relation({ name: "task" }, "owner", { kind: "belongsTo", to: "user" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "relation",
      entityName: "task",
      relationName: "owner",
    });
  });

  test("emits a ParseError when entity ref is an unresolvable identifier", () => {
    const result = parseInline(`
const taskRef = { name: "task" };
defineFeature("f", (r) => {
  r.relation(taskRef, "owner", { kind: "belongsTo", to: "user" });
});
`);

    expect(result.errors[0]?.methodName).toBe("relation");
  });
});

describe("extractNav", () => {
  test("captures the NavDefinition", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.nav({ id: "tasks", label: "Tasks", screen: "tasks:screen:list" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "nav",
      definition: { id: "tasks", label: "Tasks", screen: "tasks:screen:list" },
    });
  });
});

describe("extractWorkspace", () => {
  test("captures the WorkspaceDefinition", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.workspace({ id: "admin", label: "Admin" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "workspace",
      definition: { id: "admin", label: "Admin" },
    });
  });
});
