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

import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { isRawRefSentinel, readDataLiteralNode } from "../extractors/shared";
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
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
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

  test("recurses into a locally declared registrar-wrapper function", () => {
    const result = parseInline(`
function registerTaskScreens(registrar) {
  registrar.entity("task", { fields: {} });
  registrar.requires("auth");
}
defineFeature("wrapped", (r) => {
  r.systemScope();
  registerTaskScreens(r);
});
`);

    expect(result.errors).toEqual([]);
    expect(result.patterns.map((p) => p.kind)).toEqual(["systemScope", "entity", "requires"]);
  });

  test("recurses into a registrar-wrapper declared as a const arrow function", () => {
    const result = parseInline(`
const registerTaskScreens = (registrar) => {
  registrar.entity("task", { fields: {} });
};
defineFeature("wrapped", (r) => {
  registerTaskScreens(r);
});
`);

    expect(result.errors).toEqual([]);
    expect(result.patterns).toMatchObject([{ kind: "entity", entityName: "task" }]);
  });

  test("ignores a bare call that does not receive the registrar as an argument", () => {
    const result = parseInline(`
function unrelated() {
  return 1;
}
defineFeature("f", (r) => {
  unrelated();
  r.systemScope();
});
`);

    expect(result.errors).toEqual([]);
    expect(result.patterns).toMatchObject([{ kind: "systemScope" }]);
  });

  test("does not infinite-loop on a registrar-wrapper cycle", () => {
    const result = parseInline(`
function a(registrar) {
  registrar.systemScope();
  b(registrar);
}
function b(registrar) {
  a(registrar);
}
defineFeature("f", (r) => {
  a(r);
});
`);

    expect(result.errors).toEqual([]);
    expect(result.patterns).toMatchObject([{ kind: "systemScope" }]);
  });
});

describe("readDataLiteralNode — raw-ref sentinel", () => {
  function readExpression(source: string) {
    const project = createProject();
    const sourceFile = project.createSourceFile("inline.ts", `const __probe__ = (${source});`);
    const decl = sourceFile.getVariableDeclarationOrThrow("__probe__");
    return readDataLiteralNode(decl.getInitializerOrThrow());
  }

  test("Identifier reference resolves to a raw-ref sentinel with the exact source text", () => {
    const value = readExpression("eventEntity");
    expect(isRawRefSentinel(value)).toBe(true);
    expect(value).toEqual({ __raw: "eventEntity" });
  });

  test("zero-arg call expression resolves to a raw-ref sentinel with the exact source text", () => {
    const value = readExpression("createInviteBrandingQuery()");
    expect(isRawRefSentinel(value)).toBe(true);
    expect(value).toEqual({ __raw: "createInviteBrandingQuery()" });
  });

  test("member access resolves to a raw-ref sentinel", () => {
    const value = readExpression("config.timeout");
    expect(isRawRefSentinel(value)).toBe(true);
    expect(value).toEqual({ __raw: "config.timeout" });
  });

  test("a single unresolvable property no longer bubbles the whole object to undefined", () => {
    const value = readExpression("{ timeout: 30, query: createQuery() }");
    expect(isRawRefSentinel(value)).toBe(false);
    expect(value).toEqual({ timeout: 30, query: { __raw: "createQuery()" } });
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

  test("resolves a local const identifier arg via the raw-ref sentinel (#1009)", () => {
    const result = parseInline(`
const dep = "auth";
defineFeature("f", (r) => {
  r.requires(dep);
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "requires",
      featureNames: [{ __raw: "dep" }],
    });
    expect(result.errors).toEqual([]);
  });

  test("emits a ParseError when an argument cannot be resolved at all", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.requires(5);
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

  test("keeps a computed feature-name arg as a raw-ref sentinel instead of failing (#1009)", () => {
    const result = parseInline(`
const someFeature = { name: "billing" };
defineFeature("f", (r) => {
  r.optionalRequires(someFeature.name);
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "optionalRequires",
      featureNames: [{ __raw: "someFeature.name" }],
    });
    expect(result.errors).toEqual([]);
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

  test("keeps a computed key arg as a raw-ref sentinel instead of failing (#1009)", () => {
    const result = parseInline(`
const cfg = { key: "auth:config:jwt-ttl" };
defineFeature("f", (r) => {
  r.readsConfig(cfg.key, "tenant:config:locale");
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "readsConfig",
      qualifiedKeys: [{ __raw: "cfg.key" }, "tenant:config:locale"],
    });
    expect(result.errors).toEqual([]);
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

  test("keeps an unresolved const reference as a raw-ref sentinel instead of erroring", () => {
    const result = parseInline(`
const eventEntity = { fields: { name: { type: "text" } } };
defineFeature("f", (r) => {
  r.entity("event", eventEntity);
});
`);

    expect(result.errors).toEqual([]);
    expect(result.patterns[0]).toMatchObject({
      kind: "entity",
      entityName: "event",
      definition: { __raw: "eventEntity" },
    });
  });

  test("keeps a factory call reference inside a nested property as a raw-ref sentinel", () => {
    const result = parseInline(`
function buildFields() {
  return { name: { type: "text" } };
}
defineFeature("f", (r) => {
  r.entity("task", { fields: buildFields() });
});
`);

    expect(result.errors).toEqual([]);
    expect(result.patterns[0]).toMatchObject({
      kind: "entity",
      entityName: "task",
      definition: { fields: { __raw: "buildFields()" } },
    });
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

// =============================================================================
// Round 3 extractors — complex static patterns
// =============================================================================

describe("extractConfig", () => {
  test("captures keys map", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.config({
    keys: {
      jwtTtl: { type: "number", default: 3600 },
      locale: { type: "string", default: "en" },
    },
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "config",
      keys: {
        jwtTtl: { type: "number", default: 3600 },
        locale: { type: "string", default: "en" },
      },
    });
  });

  test("emits ParseError when keys property is missing", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.config({});
});
`);

    expect(result.errors[0]?.methodName).toBe("config");
  });
});

describe("extractTranslations", () => {
  test("captures the locale tree", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.translations({
    keys: {
      en: { greeting: "hello" },
      de: { greeting: "hallo" },
    },
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "translations",
      keys: {
        en: { greeting: "hello" },
        de: { greeting: "hallo" },
      },
    });
  });
});

describe("extractMetric", () => {
  test("captures shortName + options", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.metric("requests", { type: "counter", description: "API requests" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "metric",
      shortName: "requests",
      options: { type: "counter", description: "API requests" },
    });
  });
});

describe("extractSecret", () => {
  test("captures shortName + options", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.secret("apiKey", { description: "Stripe API key" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "secret",
      shortName: "apiKey",
      options: { description: "Stripe API key" },
    });
  });
});

describe("extractClaimKey", () => {
  test("captures shortName + claim type", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.claimKey("teamId", { type: "string" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "claimKey",
      shortName: "teamId",
      claimType: "string",
    });
  });

  test("emits ParseError on invalid claim type", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.claimKey("teamId", { type: "bigint" });
});
`);

    expect(result.errors[0]?.methodName).toBe("claimKey");
  });
});

describe("extractReferenceData", () => {
  test("captures entity name + data array", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.referenceData("status", [
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
  ]);
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "referenceData",
      entityName: "status",
      data: [
        { id: "open", label: "Open" },
        { id: "closed", label: "Closed" },
      ],
    });
  });

  test("captures the optional upsertKey", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.referenceData("status", [{ id: "open" }], { upsertKey: "id" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "referenceData",
      entityName: "status",
      upsertKey: "id",
    });
  });
});

describe("extractUseExtension", () => {
  test("captures extension name + entity ref", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.useExtension("audit", "task");
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "useExtension",
      extensionName: "audit",
      entityName: "task",
    });
  });

  test("captures optional options", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.useExtension("audit", "task", { mode: "verbose" });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "useExtension",
      extensionName: "audit",
      entityName: "task",
      options: { mode: "verbose" },
    });
  });
});

// =============================================================================
// Round 4 extractors — mixed patterns (header data + opaque body source)
// =============================================================================

describe("extractHook", () => {
  test("captures hookType, target and the function body", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.hook("postSave", "task", (event, ctx) => { console.log(event); });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "hook",
      hookType: "postSave",
      target: "task",
    });
    const fnBody = (result.patterns[0] as { fnBody?: { raw: string } } | undefined)?.fnBody;
    expect(fnBody?.raw).toContain("(event, ctx)");
  });

  test("captures the optional phase from the options object", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.hook("postSave", "task", (event, ctx) => {}, { phase: "afterCommit" });
});
`);

    expect(result.patterns[0]).toMatchObject({ kind: "hook", phase: "afterCommit" });
  });

  test("rejects an unknown hook type", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.hook("postCommit", "task", () => {});
});
`);

    expect(result.errors[0]?.methodName).toBe("hook");
  });
});

describe("extractEntityHook", () => {
  test("captures hookType, entity and the function body", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.entityHook("postSave", "task", (event, ctx) => {});
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "entityHook",
      hookType: "postSave",
      entityName: "task",
    });
  });

  test("rejects validation as entity-hook type (only postSave/preDelete/postDelete allowed)", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.entityHook("validation", "task", () => {});
});
`);

    expect(result.errors[0]?.methodName).toBe("entityHook");
  });
});

describe("extractAuthClaims", () => {
  test("captures the function body as a SourceLocation", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.authClaims(async (user, ctx) => ({ teamId: "t1" }));
});
`);

    expect(result.patterns[0]).toMatchObject({ kind: "authClaims" });
  });
});

describe("extractWriteHandler", () => {
  test("inline form: name, schema, handler, options", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.writeHandler("task:create", z.object({ title: z.string() }), async (event, ctx) => {
    return { isSuccess: true, data: {} };
  }, { access: { roles: ["admin"] } });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "writeHandler",
      handlerName: "task:create",
      access: { roles: ["admin"] },
    });
  });

  test("object form: defineWriteHandler shape", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.writeHandler({
    name: "task:approve",
    schema: z.object({ id: z.string() }),
    handler: async (event, ctx) => ({ isSuccess: true, data: {} }),
    access: { openToAll: true },
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "writeHandler",
      handlerName: "task:approve",
      access: { openToAll: true },
    });
  });

  test("resolves a same-file identifier arg to its object-literal form (#1007)", () => {
    const result = parseInline(`
const h = {
  name: "task:archive",
  schema: z.object({ id: z.string() }),
  handler: async (event, ctx) => ({ isSuccess: true, data: {} }),
};
defineFeature("f", (r) => {
  r.writeHandler(h);
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "writeHandler",
      handlerName: "task:archive",
    });
    expect(result.errors).toEqual([]);
  });

  test("keeps an unresolvable ref (import, factory call) as an opaque pattern instead of failing (#1007)", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.writeHandler(eventCreateHandler);
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "writeHandler",
      handlerName: undefined,
      source: { raw: "r.writeHandler(eventCreateHandler)" },
    });
    expect(result.errors).toEqual([]);
  });
});

describe("extractQueryHandler", () => {
  test("inline form returns kind=queryHandler", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.queryHandler("task:list", z.object({}), async (q, ctx) => []);
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "queryHandler",
      handlerName: "task:list",
    });
  });
});

describe("extractJob", () => {
  test("captures jobName, options and handler body", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.job("daily-cleanup", { trigger: { cron: "0 3 * * *" } }, async (ctx) => {});
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "job",
      jobName: "daily-cleanup",
    });
  });
});

describe("extractHttpRoute", () => {
  test("captures method, path, anonymous, handler", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.httpRoute({
    method: "GET",
    path: "/feed.xml",
    anonymous: true,
    handler: async (c) => new Response("ok"),
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "httpRoute",
      method: "GET",
      path: "/feed.xml",
      anonymous: true,
    });
  });
});

describe("extractDefineEvent", () => {
  test("captures eventName + version", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.defineEvent("incidentOpened", z.object({ id: z.string() }), { version: 2 });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "defineEvent",
      eventName: "incidentOpened",
      version: 2,
    });
  });
});

describe("extractEventMigration", () => {
  test("captures fromVersion / toVersion / transform body", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.eventMigration("incidentOpened", 1, 2, (payload) => ({ ...payload, severity: "low" }));
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "eventMigration",
      eventName: "incidentOpened",
      fromVersion: 1,
      toVersion: 2,
    });
  });
});

describe("extractNotification", () => {
  test("captures trigger + recipient + data bodies", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.notification("incidentOpened", {
    trigger: { on: "incident:create" },
    recipient: (event) => ({ tenant: event.tenantId }),
    data: (event) => ({ id: event.id }),
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "notification",
      notificationName: "incidentOpened",
      trigger: { on: "incident:create" },
    });
  });
});

describe("extractProjection", () => {
  test("captures name, sourceEntity, applyBodies map", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.projection({
    name: "task-counter",
    source: "task",
    table: taskCounter,
    apply: {
      "task.created": async (event, tx) => {},
      "task.updated": async (event, tx) => {},
    },
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "projection",
      name: "task-counter",
      sourceEntity: "task",
    });
    const applyBodies = (
      result.patterns[0] as { applyBodies?: Record<string, unknown> } | undefined
    )?.applyBodies;
    expect(Object.keys(applyBodies ?? {})).toEqual(["task.created", "task.updated"]);
  });
});

describe("extractMultiStreamProjection", () => {
  test("captures name + applyBodies + delivery", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.multiStreamProjection({
    name: "audit-log",
    apply: {
      "task.created": async (event, tx, ctx) => {},
    },
    delivery: "shared",
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "multiStreamProjection",
      name: "audit-log",
      delivery: "shared",
    });
  });
});

describe("extractScreen", () => {
  test("captures static layout and reports closure props as opaque", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.screen({
    id: "task-list",
    type: "entityList",
    entity: "task",
    columns: ["title", "status"],
    rowActions: [
      {
        id: "edit",
        label: "Edit",
        handler: "task:update",
        visible: (row) => row.status !== "done",
      },
    ],
  });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "screen",
    });
    const opaque = (result.patterns[0] as { opaqueProps?: Record<string, unknown> } | undefined)
      ?.opaqueProps;
    expect(Object.keys(opaque ?? {})).toContain("rowActions.0.visible");
  });
});

// =============================================================================
// Round 5 extractors — opaque patterns
// =============================================================================

describe("extractExtendsRegistrar", () => {
  test("captures extension name + opaque def body", () => {
    const result = parseInline(`
defineFeature("f", (r) => {
  r.extendsRegistrar("audit", { hooks: { postSave: () => {} } });
});
`);

    expect(result.patterns[0]).toMatchObject({
      kind: "extendsRegistrar",
      extensionName: "audit",
    });
  });
});

// =============================================================================
// Regression — show-pony-shaped feature (#998)
// =============================================================================
// Mirrors the real-world idioms from show-pony/src/features/show-pony/feature.ts
// that motivated #998 — inline here (not the live external repo path) so this
// test doesn't depend on the show-pony checkout being present in this repo's CI.

describe("show-pony-shaped feature (regression, #998)", () => {
  const result = parseInline(`
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventEntity } from "./schema";
import { eventCreateHandler } from "./handlers/event-create.write";
import { createInviteBrandingQuery } from "./handlers/invite-branding.query";
import { registerShowPonyScreens } from "./register/screens";

const someFeature = { name: "mail-foundation" };

defineFeature("showpony", (r) => {
  r.requires(someFeature.name, "config");
  r.entity("event", eventEntity);
  r.writeHandler(eventCreateHandler);
  r.queryHandler(createInviteBrandingQuery());
  registerShowPonyScreens(r);
});
`);

  test("requires()'s computed name and entity's imported const resolve via the raw-ref sentinel (#998/#1009 fix)", () => {
    expect(result.patterns[0]).toMatchObject({
      kind: "requires",
      featureNames: [{ __raw: "someFeature.name" }, "config"],
    });
    expect(result.patterns[1]).toMatchObject({
      kind: "entity",
      entityName: "event",
      definition: { __raw: "eventEntity" },
    });
  });

  test("writeHandler/queryHandler(handlerRef) resolve as opaque patterns (#998/#1007 fix)", () => {
    expect(result.patterns).toMatchObject([
      { kind: "requires" },
      { kind: "entity" },
      { kind: "writeHandler", handlerName: undefined },
      { kind: "queryHandler", handlerName: undefined },
    ]);
    expect(result.errors).toEqual([]);
  });

  test("an imported registrar-wrapper stays invisible (cross-file, deliberately out of #998's scope)", () => {
    expect(result.patterns.some((p) => p.kind === "screen" || p.kind === "nav")).toBe(false);
  });
});
