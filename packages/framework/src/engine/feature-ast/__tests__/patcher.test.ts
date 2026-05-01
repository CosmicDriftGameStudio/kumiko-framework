// FeaturePatcher tests: verify the imperative typed API actually
// produces the right canonical Object-Form output and that semantically
// the result reparses to the expected pattern shapes.
//
// We don't repeat the exhaustive renderer/parser cases here — those are
// pinned in render-roundtrip + canonical-form. This file exercises the
// patcher's argument shape: each typed `add{Kind}` accepts the natural
// arg layout the AI/Designer provides and creates a syntactically valid
// pattern.

import { Project, type SourceFile } from "ts-morph";
import { describe, expect, test } from "vitest";
import { parseSourceFile } from "../parse";
import { createFeaturePatcher } from "../patcher";

const STARTER = `
import { defineFeature } from "@kumiko/framework/engine";

defineFeature("inventory", (r) => {
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

describe("FeaturePatcher — typed add helpers for static patterns", () => {
  test("addEntity: typed args produce the expected pattern shape", () => {
    const sf = makeSourceFile(STARTER);
    const patcher = createFeaturePatcher(sf);
    patcher.addEntity({
      name: "task",
      definition: {
        fields: { title: { type: "text", required: true } },
      },
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns[0]).toMatchObject({
      kind: "entity",
      entityName: "task",
    });
  });

  test("addRelation: entity + relation name routed correctly", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addRelation({
      entity: "task",
      name: "owner",
      definition: { type: "belongsTo", target: "user", foreignKey: "ownerId" },
    });
    const result = parseSourceFile(sf);
    expect(result.patterns[0]).toMatchObject({
      kind: "relation",
      entityName: "task",
      relationName: "owner",
    });
  });

  test("addRequires + addToggleable + addSystemScope: singletons (object-form)", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addRequires({ features: ["auth", "tenant"] });
    p.addToggleable({ default: true });
    p.addSystemScope();
    const result = parseSourceFile(sf);
    const kinds = result.patterns.map((pp) => pp.kind);
    expect(kinds).toEqual(["requires", "toggleable", "systemScope"]);
  });

  test("addMetric / addSecret / addClaimKey", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addMetric({ name: "created", options: { type: "counter" } });
    p.addSecret({
      name: "stripeKey",
      options: { label: { en: "Stripe API Key" }, scope: "tenant" } as never,
    });
    p.addClaimKey({ name: "teamId", type: "string" });
    const result = parseSourceFile(sf);
    expect(result.patterns).toHaveLength(3);
    expect(result.patterns[0]).toMatchObject({ kind: "metric", shortName: "created" });
    expect(result.patterns[1]).toMatchObject({ kind: "secret", shortName: "stripeKey" });
    expect(result.patterns[2]).toMatchObject({ kind: "claimKey", shortName: "teamId" });
  });

  test("addReferenceData with optional upsertKey", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addReferenceData({
      entity: "category",
      data: [{ id: "a", label: "A" }],
      upsertKey: "id",
    });
    const result = parseSourceFile(sf);
    expect(result.patterns[0]).toMatchObject({
      kind: "referenceData",
      entityName: "category",
      upsertKey: "id",
    });
  });
});

describe("FeaturePatcher — typed add helpers for mixed (closure-bearing) patterns", () => {
  test("addWriteHandler with handler source string", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addWriteHandler({
      name: "task:create",
      schemaSource: "z.object({ title: z.string() })",
      handlerSource: 'async (event, ctx) => { return { isSuccess: true, data: { id: "x" } }; }',
      access: { roles: ["user"] },
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    const pattern = result.patterns[0];
    expect(pattern?.kind).toBe("writeHandler");
    if (pattern?.kind === "writeHandler") {
      expect(pattern.handlerName).toBe("task:create");
      expect(pattern.handlerBody.raw).toContain("isSuccess: true");
      expect(pattern.access).toMatchObject({ roles: ["user"] });
    }
  });

  test("addQueryHandler routes openToAll access", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addQueryHandler({
      name: "task:list",
      schemaSource: "z.object({})",
      handlerSource: "async (q, ctx) => []",
      access: { openToAll: true },
    });
    const result = parseSourceFile(sf);
    const pattern = result.patterns[0];
    expect(pattern).toMatchObject({
      kind: "queryHandler",
      handlerName: "task:list",
      access: { openToAll: true },
    });
  });

  test("addHook with target string", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addHook({
      type: "postSave",
      target: "task",
      handlerSource: 'async (event, ctx) => { console.log("saved"); }',
    });
    const result = parseSourceFile(sf);
    expect(result.patterns[0]).toMatchObject({
      kind: "hook",
      hookType: "postSave",
      target: "task",
    });
  });

  test("addEntityHook routes type + entity correctly", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addEntityHook({
      type: "postDelete",
      entity: "task",
      handlerSource: "async (event, ctx) => { /* cleanup */ }",
    });
    const result = parseSourceFile(sf);
    expect(result.patterns[0]).toMatchObject({
      kind: "entityHook",
      hookType: "postDelete",
      entityName: "task",
    });
  });

  test("addDefineEvent + addEventMigration form a complete event-versioning chain", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addDefineEvent({
      name: "stepCompleted",
      schemaSource: "z.object({ id: z.string() })",
      version: 2,
    });
    p.addEventMigration({
      event: "stepCompleted",
      fromVersion: 1,
      toVersion: 2,
      transformSource: '(old) => ({ id: old.id ?? "" })',
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns).toHaveLength(2);
    expect(result.patterns[0]).toMatchObject({
      kind: "defineEvent",
      eventName: "stepCompleted",
      version: 2,
    });
    expect(result.patterns[1]).toMatchObject({
      kind: "eventMigration",
      eventName: "stepCompleted",
      fromVersion: 1,
      toVersion: 2,
    });
  });
});

describe("FeaturePatcher — symmetric ops (replace / remove / apply)", () => {
  test("replace via PatternId on a previously added pattern", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addMetric({ name: "created", options: { type: "counter" } });
    p.replace(
      { kind: "metric", shortName: "created" },
      {
        kind: "metric",
        source: { file: "x", start: { line: 1, column: 1 }, end: { line: 1, column: 1 }, raw: "" },
        shortName: "created",
        options: { type: "histogram" } as never,
      },
    );
    const result = parseSourceFile(sf);
    const metric = result.patterns.find((pp) => pp.kind === "metric");
    if (metric?.kind === "metric") {
      expect(metric.options).toMatchObject({ type: "histogram" });
    }
  });

  test("remove + apply work through the patcher facade", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addEntity({ name: "task", definition: { fields: {} } as never });
    p.addEntity({ name: "user", definition: { fields: {} } as never });
    p.remove({ kind: "entity", entityName: "task" });
    const result = parseSourceFile(sf);
    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({ kind: "entity", entityName: "user" });
  });

  test("apply (bulk) works as ergonomic wrapper around applyChanges", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.apply([
      {
        op: "add",
        pattern: {
          kind: "secret",
          source: {
            file: "x",
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
            raw: "",
          },
          shortName: "k1",
          options: { label: { en: "First Key" } } as never,
        },
      },
      {
        op: "add",
        pattern: {
          kind: "secret",
          source: {
            file: "x",
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 },
            raw: "",
          },
          shortName: "k2",
          options: { label: { en: "Second Key" } } as never,
        },
      },
    ]);
    const result = parseSourceFile(sf);
    expect(result.patterns.map((pp) => pp.kind)).toEqual(["secret", "secret"]);
  });
});

describe("FeaturePatcher — coverage for the remaining typed adds", () => {
  test("addOptionalRequires + addReadsConfig: object-form like addRequires", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addOptionalRequires({ features: ["analytics"] });
    p.addReadsConfig({ keys: ["billing:plan"] });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns).toMatchObject([
      { kind: "optionalRequires", featureNames: ["analytics"] },
      { kind: "readsConfig", qualifiedKeys: ["billing:plan"] },
    ]);
  });

  test("addNav + addWorkspace + addScreen pass definition through", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addNav({ definition: { id: "tasks", label: "Tasks", screen: "feat:screen:list" } });
    p.addWorkspace({ definition: { id: "personal", label: "Personal" } });
    p.addScreen({
      definition: {
        id: "list",
        type: "entityList",
        entity: "task",
        columns: ["title"],
      } as never,
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns.map((pp) => pp.kind)).toEqual(["nav", "workspace", "screen"]);
  });

  test("addConfig + addTranslations: keys-bearing objects", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addConfig({
      keys: { maxItems: { type: "number", default: 100 } as never },
    });
    p.addTranslations({ keys: { en: { hello: "Hi" } } });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns.map((pp) => pp.kind)).toEqual(["config", "translations"]);
  });

  test("addAuthClaims wraps the handler-source as a closure", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addAuthClaims({
      handlerSource: 'async (user, ctx) => ({ teamId: "t1" })',
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    const ac = result.patterns.find((pp) => pp.kind === "authClaims");
    expect(ac).toMatchObject({ kind: "authClaims" });
    if (ac?.kind === "authClaims") {
      expect(ac.fnBody.raw).toContain("teamId");
    }
  });

  test("addHttpRoute: method + path + handler", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addHttpRoute({
      method: "GET",
      path: "/health",
      handlerSource: "async (c) => c.json({ ok: true })",
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns[0]).toMatchObject({
      kind: "httpRoute",
      method: "GET",
      path: "/health",
    });
  });

  test("addProjection + addMultiStreamProjection: name + applyBodies-Map", () => {
    const sf = makeSourceFile(STARTER);
    const p = createFeaturePatcher(sf);
    p.addProjection({
      name: "taskSummary",
      sourceEntity: "task",
      applySources: { "todo:event:created": "async (event, ctx) => {}" },
    });
    p.addMultiStreamProjection({
      name: "tenantTaskCount",
      applySources: { "todo:event:created": "async (event, ctx) => {}" },
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns.map((pp) => pp.kind)).toEqual(["projection", "multiStreamProjection"]);
  });

  test("addJob: name + options + handler routed correctly", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addJob({
      name: "cleanupExpired",
      options: { schedule: { cron: "0 3 * * *" } } as never,
      handlerSource: 'async (ctx) => { console.log("cleanup"); }',
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    const job = result.patterns.find((pp) => pp.kind === "job");
    expect(job).toMatchObject({ kind: "job", jobName: "cleanupExpired" });
  });

  test("addNotification: trigger + recipient + data + templates", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addNotification({
      name: "taskAssigned",
      trigger: { on: "task" },
      recipientSource: "async (event, ctx) => []",
      dataSource: 'async (event, ctx) => ({ title: "x" })',
      templates: {
        email: 'async (event, ctx, data) => ({ subject: "x", body: "y" })',
      },
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    const n = result.patterns.find((pp) => pp.kind === "notification");
    expect(n).toMatchObject({
      kind: "notification",
      notificationName: "taskAssigned",
      trigger: { on: "task" },
    });
    if (n?.kind === "notification") {
      expect(n.templates?.["email"]?.raw).toContain("subject");
    }
  });

  test("addUseExtension: name + entity + optional options", () => {
    const sf = makeSourceFile(STARTER);
    createFeaturePatcher(sf).addUseExtension({
      extension: "auditLog",
      entity: "task",
      options: { level: "verbose" },
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns[0]).toMatchObject({
      kind: "useExtension",
      extensionName: "auditLog",
      entityName: "task",
    });
  });
});

describe("FeaturePatcher — AI workflow simulation", () => {
  // Mimics what the AI-Builder would emit as a sequence of method calls
  // for "Create a task feature with title + done field, a list query, and
  // a soft-delete hook." Every method takes the natural args the LLM has
  // (no FeaturePattern internal-shape knowledge required).
  test("end-to-end: 4 patterns added, file parses clean, kinds + names match", () => {
    const sf = makeSourceFile(`
import { defineFeature } from "@kumiko/framework/engine";

defineFeature("tasks", (r) => {
});
`);
    const p = createFeaturePatcher(sf);
    p.addEntity({
      name: "task",
      definition: {
        fields: {
          title: { type: "text", required: true },
          done: { type: "boolean", default: false },
        },
      },
    });
    p.addWriteHandler({
      name: "task:create",
      schemaSource: "z.object({ title: z.string() })",
      handlerSource: 'async (event, ctx) => ({ isSuccess: true, data: { id: "new" } })',
      access: { roles: ["user"] },
    });
    p.addQueryHandler({
      name: "task:list",
      schemaSource: "z.object({})",
      handlerSource: "async (q, ctx) => []",
      access: { openToAll: true },
    });
    p.addEntityHook({
      type: "postDelete",
      entity: "task",
      handlerSource: "async (event, ctx) => { /* cascade-clean */ }",
    });
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns.map((pp) => pp.kind)).toEqual([
      "entity",
      "writeHandler",
      "queryHandler",
      "entityHook",
    ]);
  });
});
