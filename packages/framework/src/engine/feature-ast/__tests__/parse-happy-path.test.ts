// Happy-path roundtrip: a single feature file that exercises the
// inline authoring contract end-to-end. Every r.* call here is the
// shape AI-generated features will use + that the Designer will edit.
//
// Why this matters: real bundled-features (parse-real-features.test.ts)
// fail many extractors because they use factories + identifier handlers.
// That is fine for framework-internal code, but the AI Builder must
// NEVER produce code with ParseErrors. This test pins the contract.

import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { parseSourceFile } from "../parse";

const INLINE_FEATURE = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("todoList", (r) => {
  r.requires("auth", "tenant");
  r.toggleable({ default: true });

  r.entity("task", {
    fields: {
      title: { type: "text", required: true, searchable: true },
      done: { type: "boolean", default: false },
      priority: { type: "select", options: ["low", "medium", "high"], default: "medium" },
    },
  });

  r.relation("task", "owner", { kind: "belongsTo", to: "user" });

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

  r.defineEvent("taskCompleted", z.object({ id: z.string() }), { version: 1 });

  r.writeHandler(
    "task:create",
    z.object({ title: z.string(), priority: z.string().optional() }),
    async (event, ctx) => {
      return { isSuccess: true, data: { id: "x" } };
    },
    { access: { roles: ["user"] } },
  );

  r.writeHandler({
    name: "task:complete",
    schema: z.object({ id: z.string() }),
    handler: async (event, ctx) => ({ isSuccess: true, data: {} }),
    access: { roles: ["user"] },
  });

  r.queryHandler(
    "task:list",
    z.object({}),
    async (q, ctx) => [],
    { access: { openToAll: true } },
  );

  r.hook("postSave", "task", async (event, ctx) => {
    console.log("task saved");
  });

  r.entityHook("postDelete", "task", async (event, ctx) => {
    console.log("task deleted");
  });

  r.metric("requests", { type: "counter" });
  r.secret("apiKey", { description: "Stripe API key" });
  r.claimKey("teamId", { type: "string" });

  r.referenceData(
    "priorityLabel",
    [
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ],
    { upsertKey: "id" },
  );

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

describe("parseSourceFile against a complete inline-form feature", () => {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  const sourceFile = project.createSourceFile("inline-feature.ts", INLINE_FEATURE);
  const result = parseSourceFile(sourceFile);

  test("featureName is read correctly", () => {
    expect(result.featureName).toBe("todoList");
  });

  test("zero ParseErrors — the inline contract is fully extractable", () => {
    expect(result.errors).toEqual([]);
  });

  test("zero UnknownPatterns — every r.* call dispatched to a real extractor", () => {
    const unknowns = result.patterns.filter((p) => p.kind === "unknown");
    expect(unknowns).toEqual([]);
  });

  test("all expected pattern-kinds are present", () => {
    const kinds: ReadonlySet<string> = new Set(result.patterns.map((p) => p.kind));
    const expected: readonly string[] = [
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
      expect(kinds.has(e), `expected kind "${e}" to appear`).toBe(true);
    }
  });

  test("both writeHandler authoring forms (inline + object) produce separate patterns", () => {
    const writeHandlers = result.patterns.filter((p) => p.kind === "writeHandler");
    expect(writeHandlers).toHaveLength(2);
    const handlerNames = writeHandlers.map((p) => (p as { handlerName: string }).handlerName);
    expect(handlerNames).toContain("task:create");
    expect(handlerNames).toContain("task:complete");
  });

  test("AccessRule is extracted into the typed shape (roles vs openToAll)", () => {
    const writeCreate = result.patterns.find(
      (p) =>
        p.kind === "writeHandler" && (p as { handlerName: string }).handlerName === "task:create",
    );
    expect(writeCreate).toMatchObject({
      access: { roles: ["user"] },
    });

    const queryList = result.patterns.find((p) => p.kind === "queryHandler");
    expect(queryList).toMatchObject({
      access: { openToAll: true },
    });
  });

  test("SourceLocation roundtrips raw text for opaque bodies", () => {
    const hook = result.patterns.find((p) => p.kind === "hook") as
      | { fnBody: { raw: string } }
      | undefined;
    expect(hook?.fnBody.raw).toContain("task saved");

    const writeCreate = result.patterns.find(
      (p) =>
        p.kind === "writeHandler" && (p as { handlerName: string }).handlerName === "task:create",
    ) as { handlerBody: { raw: string }; schemaSource: { raw: string } } | undefined;
    expect(writeCreate?.handlerBody.raw).toContain("isSuccess: true");
    expect(writeCreate?.schemaSource.raw).toContain("z.object");
  });

  test("source order matches authoring order", () => {
    const orderedKinds = result.patterns.map((p) => p.kind);
    expect(orderedKinds[0]).toBe("requires");
    expect(orderedKinds[1]).toBe("toggleable");
    expect(orderedKinds[2]).toBe("entity");
    expect(orderedKinds[3]).toBe("relation");
  });
});
