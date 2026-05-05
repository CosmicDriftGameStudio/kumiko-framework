// Canonical-Form Spec — sämtliche r.* Calls in der Designer/AI-canonical
// Object-Form. Jeder Pattern hat genau EIN Argument: ein Object-Literal
// mit allen Feldern als Properties. Begründung:
//
//   - **AI-friendly**: 1 JSON-Schema pro Pattern. LLM lernt eine Form.
//   - **Renderer-friendly**: 1 Schablone für alle 30 Patterns.
//   - **Diff-friendly**: Property-add/remove ist eine Zeile, kein
//     Argument-shuffle.
//
// **Coexistenz**: Parser akzeptiert weiterhin die positional-arg-Form
// (siehe parse-happy-path.test.ts). Bundled-features + PublicStatus
// bleiben in der alten Form (Designer-exempt). Renderer-Output ist
// IMMER canonical Object-Form.
//
// **Schema-Version-Header**: Renderer-Output beginnt mit
// `// kumiko-feature-version: 1` — sodass künftige Format-Bumps
// gezielt migriert werden können (separater Migrator pro Version).

import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { parseSourceFile } from "../parse";

const CANONICAL_FEATURE = `
// kumiko-feature-version: 1
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("todoList", (r) => {
  r.requires({ features: ["auth", "tenant"] });
  r.toggleable({ default: true });

  r.entity({
    name: "task",
    fields: {
      title: { type: "text", required: true, searchable: true },
      done: { type: "boolean", default: false },
      priority: { type: "select", options: ["low", "medium", "high"], default: "medium" },
    },
  });

  r.relation({ entity: "task", name: "owner", kind: "belongsTo", to: "user" });

  r.config({
    keys: {
      maxItems: { type: "number", default: 100 },
    },
  });

  r.translations({
    keys: {
      en: { title: "Tasks", create: "Create task" },
      de: { title: "Aufgaben", create: "Aufgabe anlegen" },
    },
  });

  r.defineEvent({
    name: "taskCompleted",
    schema: z.object({ id: z.string() }),
    version: 1,
  });

  r.writeHandler({
    name: "task:create",
    schema: z.object({ title: z.string(), priority: z.string().optional() }),
    handler: async (event, ctx) => {
      return { isSuccess: true, data: { id: "x" } };
    },
    access: { roles: ["user"] },
  });

  r.queryHandler({
    name: "task:list",
    schema: z.object({}),
    handler: async (q, ctx) => [],
    access: { openToAll: true },
  });

  r.hook({
    type: "postSave",
    target: "task",
    handler: async (event, ctx) => {
      console.log("task saved");
    },
  });

  r.entityHook({
    type: "postDelete",
    entity: "task",
    handler: async (event, ctx) => {
      console.log("task deleted");
    },
  });

  r.metric({ name: "requests", type: "counter" });

  r.secret({ name: "apiKey", description: "Stripe API key" });

  r.claimKey({ name: "teamId", type: "string" });

  r.referenceData({
    entity: "priorityLabel",
    data: [
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ],
    upsertKey: "id",
  });

  r.nav({ id: "tasks", label: "Tasks", screen: "todoList:screen:task-list" });

  r.workspace({ id: "personal", label: "Personal" });

  r.screen({
    id: "task-list",
    type: "entityList",
    entity: "task",
    columns: ["title", "priority", "done"],
  });

  // --- The remaining 12 pattern-kinds — ensures full canonical-form coverage. ---

  r.optionalRequires({ features: ["analytics"] });

  r.readsConfig({ keys: ["billing:plan"] });

  r.systemScope();

  r.useExtension({ name: "auditLog", entity: "task" });

  r.eventMigration({
    event: "taskCompleted",
    fromVersion: 1,
    toVersion: 2,
    transform: (old) => ({ ...old, done: true }),
  });

  r.job({
    name: "cleanupExpired",
    schedule: { cron: "0 3 * * *" },
    handler: async (ctx) => {
      console.log("cleanup");
    },
  });

  r.notification({
    name: "taskAssigned",
    trigger: { on: "task" },
    recipient: async (event, ctx) => [],
    data: async (event, ctx) => ({ title: "x" }),
    templates: {
      email: async (event, ctx, data) => ({ subject: "x", body: "y" }),
    },
  });

  r.authClaims(async (user, ctx) => ({ teamId: "t1" }));

  r.httpRoute({
    method: "GET",
    path: "/health",
    handler: async (c) => c.json({ ok: true }),
  });

  r.projection({
    name: "taskSummary",
    source: "task",
    apply: {
      "todo:event:created": async (event, ctx) => {},
    },
  });

  r.multiStreamProjection({
    name: "tenantTaskCount",
    apply: {
      "todo:event:created": async (event, ctx) => {},
    },
  });
});
`;

describe("Canonical Object-Form — parser akzeptiert + extrahiert", () => {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  const sourceFile = project.createSourceFile("canonical.ts", CANONICAL_FEATURE);
  const result = parseSourceFile(sourceFile);

  test("featureName wird gelesen", () => {
    expect(result.featureName).toBe("todoList");
  });

  test("alle r.* Calls werden ohne Errors extrahiert", () => {
    expect(result.errors).toEqual([]);
  });

  test("kein UnknownPattern — jede r.*-Methode ist erkannt", () => {
    const unknowns = result.patterns.filter((p) => p.kind === "unknown");
    expect(unknowns).toEqual([]);
  });

  test("alle 28 Pattern-Kinds sind erfasst", () => {
    const kinds: ReadonlySet<string> = new Set(result.patterns.map((p) => p.kind));
    const expected = [
      // Static
      "requires",
      "optionalRequires",
      "readsConfig",
      "systemScope",
      "toggleable",
      "entity",
      "relation",
      "config",
      "translations",
      "metric",
      "secret",
      "claimKey",
      "referenceData",
      "useExtension",
      "nav",
      "workspace",
      // Mixed
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
    ];
    for (const e of expected) {
      expect(kinds.has(e), `expected kind "${e}"`).toBe(true);
    }
  });

  test("entity Pattern: name + fields aus Object-Form", () => {
    const entity = result.patterns.find((p) => p.kind === "entity");
    expect(entity).toMatchObject({
      kind: "entity",
      entityName: "task",
    });
  });

  test("relation Pattern: entity + name aus Object-Form", () => {
    const relation = result.patterns.find((p) => p.kind === "relation");
    expect(relation).toMatchObject({
      kind: "relation",
      entityName: "task",
      relationName: "owner",
    });
  });

  test("hook Pattern: type + target aus Object-Form", () => {
    const hook = result.patterns.find((p) => p.kind === "hook");
    expect(hook).toMatchObject({
      kind: "hook",
      hookType: "postSave",
      target: "task",
    });
  });

  test("entityHook Pattern: type + entity aus Object-Form", () => {
    const entityHook = result.patterns.find((p) => p.kind === "entityHook");
    expect(entityHook).toMatchObject({
      kind: "entityHook",
      hookType: "postDelete",
      entityName: "task",
    });
  });

  test("metric / secret / claimKey: name aus Object-Form", () => {
    const metric = result.patterns.find((p) => p.kind === "metric");
    expect(metric).toMatchObject({ kind: "metric", shortName: "requests" });
    const secret = result.patterns.find((p) => p.kind === "secret");
    expect(secret).toMatchObject({ kind: "secret", shortName: "apiKey" });
    const claim = result.patterns.find((p) => p.kind === "claimKey");
    expect(claim).toMatchObject({ kind: "claimKey", shortName: "teamId" });
  });

  test("defineEvent: name + version aus Object-Form", () => {
    const ev = result.patterns.find((p) => p.kind === "defineEvent");
    expect(ev).toMatchObject({
      kind: "defineEvent",
      eventName: "taskCompleted",
      version: 1,
    });
  });

  test("referenceData: entity + upsertKey aus Object-Form", () => {
    const ref = result.patterns.find((p) => p.kind === "referenceData");
    expect(ref).toMatchObject({
      kind: "referenceData",
      entityName: "priorityLabel",
      upsertKey: "id",
    });
  });

  test("requires: featureNames aus features-Array", () => {
    const req = result.patterns.find((p) => p.kind === "requires");
    expect(req).toMatchObject({
      kind: "requires",
      featureNames: ["auth", "tenant"],
    });
  });

  test("optionalRequires: featureNames aus features-Array", () => {
    const opt = result.patterns.find((p) => p.kind === "optionalRequires");
    expect(opt).toMatchObject({
      kind: "optionalRequires",
      featureNames: ["analytics"],
    });
  });

  test("readsConfig: qualifiedKeys aus keys-Array", () => {
    const rc = result.patterns.find((p) => p.kind === "readsConfig");
    expect(rc).toMatchObject({
      kind: "readsConfig",
      qualifiedKeys: ["billing:plan"],
    });
  });

  test("useExtension: name + entity aus Object-Form", () => {
    const ue = result.patterns.find((p) => p.kind === "useExtension");
    expect(ue).toMatchObject({
      kind: "useExtension",
      extensionName: "auditLog",
      entityName: "task",
    });
  });

  test("eventMigration: event + fromVersion + toVersion aus Object-Form", () => {
    const em = result.patterns.find((p) => p.kind === "eventMigration");
    expect(em).toMatchObject({
      kind: "eventMigration",
      eventName: "taskCompleted",
      fromVersion: 1,
      toVersion: 2,
    });
  });

  test("job: name + handlerBody.raw enthält den Closure-Body", () => {
    const job = result.patterns.find((p) => p.kind === "job");
    expect(job).toMatchObject({ kind: "job", jobName: "cleanupExpired" });
    if (job?.kind === "job") {
      expect(job.handlerBody.raw).toContain("cleanup");
    }
  });

  test("notification: name + trigger.on + body-spans", () => {
    const n = result.patterns.find((p) => p.kind === "notification");
    expect(n).toMatchObject({
      kind: "notification",
      notificationName: "taskAssigned",
      trigger: { on: "task" },
    });
    if (n?.kind === "notification") {
      expect(n.recipientBody.raw).toContain("event");
      expect(n.dataBody.raw).toContain("title");
      expect(n.templates?.["email"]?.raw).toContain("subject");
    }
  });

  test("authClaims: fnBody.raw enthält den Handler-Body", () => {
    const ac = result.patterns.find((p) => p.kind === "authClaims");
    expect(ac).toMatchObject({ kind: "authClaims" });
    if (ac?.kind === "authClaims") {
      expect(ac.fnBody.raw).toContain("teamId");
    }
  });

  test("httpRoute: method + path + handlerBody-Span", () => {
    const route = result.patterns.find((p) => p.kind === "httpRoute");
    expect(route).toMatchObject({
      kind: "httpRoute",
      method: "GET",
      path: "/health",
    });
    if (route?.kind === "httpRoute") {
      expect(route.handlerBody.raw).toContain("ok: true");
    }
  });

  test("projection: name + sourceEntity + applyBodies-Map", () => {
    const proj = result.patterns.find((p) => p.kind === "projection");
    expect(proj).toMatchObject({
      kind: "projection",
      name: "taskSummary",
      sourceEntity: "task",
    });
    if (proj?.kind === "projection") {
      expect(Object.keys(proj.applyBodies)).toContain("todo:event:created");
    }
  });

  test("multiStreamProjection: name + applyBodies", () => {
    const msp = result.patterns.find((p) => p.kind === "multiStreamProjection");
    expect(msp).toMatchObject({
      kind: "multiStreamProjection",
      name: "tenantTaskCount",
    });
    if (msp?.kind === "multiStreamProjection") {
      expect(Object.keys(msp.applyBodies)).toContain("todo:event:created");
    }
  });

  test("systemScope: kind-only marker", () => {
    const ss = result.patterns.find((p) => p.kind === "systemScope");
    expect(ss).toMatchObject({ kind: "systemScope" });
  });
});
