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
import { defineFeature } from "@kumiko/framework/engine";
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

  test("alle 18 Pattern-Kinds sind erfasst", () => {
    const kinds: ReadonlySet<string> = new Set(result.patterns.map((p) => p.kind));
    const expected = [
      "requires",
      "toggleable",
      "entity",
      "relation",
      "config",
      "translations",
      "defineEvent",
      "writeHandler",
      "queryHandler",
      "hook",
      "entityHook",
      "metric",
      "secret",
      "claimKey",
      "referenceData",
      "nav",
      "workspace",
      "screen",
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
});
