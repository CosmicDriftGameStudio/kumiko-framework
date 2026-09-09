import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { buildAgentManifest } from "../agent-manifest";
import { buildToolCatalog, toolNameForQn } from "../tool-catalog";
import type { AgentManifest, AgentToolMode, RegistrySearchView } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const widgetEntity = createEntity({
  fields: {
    name: createTextField({ searchable: true, filterable: true }),
    status: createSelectField({ options: ["open", "closed"] as const, filterable: true }),
    notes: createTextField(),
  },
});

const orphanEntity = createEntity({ fields: { label: createTextField() } });

function buildCatalogTestFeature() {
  return defineFeature("catalog-test", (r) => {
    // create/update excluded from the generated set: EntityHandlerOptions has no
    // `description`, so a CRUD-generated create/update is never agent-exposed
    // (resolveAgentExposure needs description or agent.expose) — registered
    // explicitly below instead, so open_form's entityEdit-mapping has something
    // to find in manifest.handlers.
    r.crud("widget", widgetEntity, {
      write: { access: { roles: ["Admin"] } },
      read: { access: { roles: ["Admin", "Reader"] } },
      verbs: { create: false, update: false },
    });
    r.writeHandler(
      "widget:create",
      z.object({ name: z.string(), status: z.enum(["open", "closed"]).optional() }),
      async () => ({ isSuccess: true as const, data: { id: "w1", version: 1 } }),
      { access: { roles: ["Admin"] }, description: "Create a widget." },
    );
    r.writeHandler(
      "widget:update",
      z.object({ id: z.string(), version: z.number(), changes: z.record(z.string(), z.unknown()) }),
      async () => ({ isSuccess: true as const, data: { id: "w1", version: 2 } }),
      { access: { roles: ["Admin"] }, description: "Update a widget." },
    );

    // Entity with no mounted handlers — the "skip when nothing callable" case.
    r.entity("orphan", orphanEntity);

    r.writeHandler(
      "widget:approve",
      z.object({ id: z.string(), version: z.number(), note: z.string() }),
      async () => ({ isSuccess: true as const, data: { id: "w1", version: 2 } }),
      { access: { roles: ["Admin"] }, description: "Approve a widget." },
    );

    // No entity mapping (bare name, not a CRUD verb) — exercises the detailQn-less write path.
    r.writeHandler("ping", z.object({}), async () => ({ isSuccess: true as const, data: {} }), {
      access: { roles: ["Admin"] },
      description: "Ping the service.",
    });

    r.queryHandler("widget:summary", z.object({ id: z.string() }), async () => ({ count: 0 }), {
      access: { roles: ["Admin"] },
      description: "Widget summary stats.",
    });

    // Two valid-but-distinct QNs whose sanitized tool name collides: every run of
    // non-identifier characters collapses to a single "_", so a single vs. a double
    // hyphen both normalize to "..._approve_x". QN segments can't contain "_" themselves
    // (registry validation), so the collision has to come from hyphen-collapsing instead.
    r.writeHandler(
      "widget:approve--x",
      z.object({ id: z.string() }),
      async () => ({ isSuccess: true as const, data: {} }),
      { access: { roles: ["Admin"] }, description: "Approve X (double hyphen)." },
    );
    r.writeHandler(
      "widget:approve-x",
      z.object({ id: z.string() }),
      async () => ({ isSuccess: true as const, data: {} }),
      { access: { roles: ["Admin"] }, description: "Approve X." },
    );

    r.screen({
      id: "widget-detail",
      type: "custom",
      renderer: { react: "stub" },
      detailFor: "widget",
    });
    r.screen({
      id: "widget-edit",
      type: "entityEdit",
      entity: "widget",
      layout: { sections: [{ title: "s", fields: ["name"] }] },
    });
    r.screen({
      id: "widget-approve-form",
      type: "actionForm",
      handler: "catalog-test:write:widget:approve",
      fields: { note: createTextField() },
      layout: { sections: [{ title: "s", fields: ["note"] }] },
    });
  });
}

type CatalogRequest = {
  readonly mode: AgentToolMode;
  readonly roles: readonly string[];
  readonly locale: string;
};

function buildCatalog({ mode, roles, locale }: CatalogRequest) {
  const registry = createRegistry([buildCatalogTestFeature()]);
  const manifest = buildAgentManifest(registry, { locale, roles });
  return buildToolCatalog(registry, manifest, { mode });
}

const ADMIN: CatalogRequest = { mode: "edit", roles: ["Admin"], locale: "en" };
const READER: CatalogRequest = { mode: "edit", roles: ["Reader"], locale: "en" };

describe("buildToolCatalog — search_<entity> / find_<entity>_by_<field> (existing generation)", () => {
  test("generates search_<entity> and find_<entity>_by_<field> for a mounted :list handler", () => {
    const catalog = buildCatalog(ADMIN);
    const names = catalog.tools.map((t) => t.name);
    expect(names).toContain("search_widget");
    expect(names).toContain("find_widget_by_name");
    expect(names).toContain("find_widget_by_status");
    expect(names).not.toContain("find_widget_by_notes");
  });

  test("skips an entity with no mounted :list handler", () => {
    const catalog = buildCatalog(ADMIN);
    const names = catalog.tools.map((t) => t.name);
    expect(names).not.toContain("search_orphan");
    expect(names).not.toContain("get_orphan");
    expect(names).not.toContain("list_orphan");
  });

  test("both catalog halves read the same role source: an unknown role gets neither half", () => {
    const catalog = buildCatalog({ mode: "edit", roles: ["Nobody"], locale: "en" });
    const names = catalog.tools.map((t) => t.name);
    // Registry-derived half and manifest-derived half both vanish for a role that matches
    // nothing — they can only agree because both follow `manifest.builtForRoles`.
    expect(names).not.toContain("search_widget");
    expect(names).not.toContain("find_widget_by_name");
    expect(names).not.toContain("get_widget");
    expect(names).not.toContain("list_widget");
    expect(names).not.toContain(toolNameForQn("catalog-test:query:widget:summary"));
    expect(names).not.toContain(toolNameForQn("catalog-test:write:widget:approve"));
    expect(names).toEqual(["navigate", "ask_user"]);
  });

  test("@ts-expect-error: ToolCatalogOptions has no roles channel of its own", () => {
    const registry = createRegistry([buildCatalogTestFeature()]);
    const manifest = buildAgentManifest(registry, { locale: "en", roles: ["Admin"] });
    // @ts-expect-error: roles must come from the manifest; a second channel could desync the halves.
    const catalog = buildToolCatalog(registry, manifest, { mode: "edit", roles: ["Nobody"] });
    expect(catalog.tools.length).toBeGreaterThan(0);
  });
});

describe("buildToolCatalog — get_<entity> / list_<entity>", () => {
  test("get_<entity> fetches by id via the mounted :detail handler", () => {
    const catalog = buildCatalog(ADMIN);
    const tool = catalog.tools.find((t) => t.name === "get_widget");
    expect(tool?.inputSchema).toEqual({
      type: "object",
      properties: { id: { type: "string", description: "Record id (uuid)" } },
      required: ["id"],
      additionalProperties: false,
    });
    expect(catalog.dispatchTable.get("get_widget")).toEqual({
      kind: "server",
      op: "query",
      qn: "catalog-test:query:widget:detail",
      risk: "low",
      entity: "widget",
      detail: true,
    });
  });

  test("list_<entity> names searchable + filterable fields and states the total count", () => {
    const catalog = buildCatalog(ADMIN);
    const tool = catalog.tools.find((t) => t.name === "list_widget");
    expect(tool?.description).toContain("name");
    expect(tool?.description).toContain("status");
    expect(tool?.description.toLowerCase()).toContain("total");
    expect(tool?.inputSchema).toMatchObject({
      properties: {
        search: { type: "string" },
        filters: {
          type: "array",
          items: { properties: { field: { enum: ["name", "status"] } } },
        },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: [],
      additionalProperties: false,
    });
    expect(catalog.dispatchTable.get("list_widget")).toEqual({
      kind: "server",
      op: "query",
      qn: "catalog-test:query:widget:list",
      risk: "low",
      entity: "widget",
      list: { searchableFields: ["name"], filterableFields: ["name", "status"] },
    });
  });
});

describe("buildToolCatalog — handler-derived query/write tools", () => {
  test("a described, non-CRUD query handler becomes its own tool, role-gated", () => {
    const admin = buildCatalog(ADMIN);
    const reader = buildCatalog(READER);
    expect(admin.tools.map((t) => t.name)).toContain("catalog_test_widget_summary");
    expect(reader.tools.map((t) => t.name)).not.toContain("catalog_test_widget_summary");
  });

  test("a described write handler becomes a tool with injectsVersion + a stripped schema when a readable detail handler exists", () => {
    const catalog = buildCatalog(ADMIN);
    const name = toolNameForQn("catalog-test:write:widget:approve");
    const tool = catalog.tools.find((t) => t.name === name);
    const schema = tool?.inputSchema ?? {};
    const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
    const required = Array.isArray(schema["required"]) ? schema["required"] : [];

    expect(properties).toHaveProperty("id");
    expect(properties).toHaveProperty("note");
    expect(properties).not.toHaveProperty("version");
    expect(required).toContain("id");
    expect(required).toContain("note");
    expect(required).not.toContain("version");

    expect(catalog.dispatchTable.get(name)).toEqual({
      kind: "server",
      op: "write",
      qn: "catalog-test:write:widget:approve",
      risk: "mid",
      entity: "widget",
      detailQn: "catalog-test:query:widget:detail",
      injectsVersion: true,
    });
  });

  test("a write handler with no entity mapping gets no detailQn and no version injection", () => {
    const catalog = buildCatalog(ADMIN);
    const name = toolNameForQn("catalog-test:write:ping");
    expect(catalog.dispatchTable.get(name)).toEqual({
      kind: "server",
      op: "write",
      qn: "catalog-test:write:ping",
      risk: "mid",
    });
  });

  test("read-only mode produces no write tools and no open_form descriptor", () => {
    const readOnly = buildCatalog({ mode: "read-only", roles: ["Admin"], locale: "en" });
    const names = readOnly.tools.map((t) => t.name);
    expect(names).not.toContain(toolNameForQn("catalog-test:write:widget:approve"));
    expect(names).not.toContain(toolNameForQn("catalog-test:write:ping"));
    expect(readOnly.dispatchTable.has("open_form")).toBe(false);
    // Read-side tools + client tools stay available.
    expect(names).toContain("get_widget");
    expect(names).toContain("list_widget");
    expect(names).toContain("navigate");
    expect(names).toContain("ask_user");
  });

  test("a name collision between two handler-derived tools skips the later one instead of shadowing it", () => {
    const catalog = buildCatalog(ADMIN);
    const collidingName = toolNameForQn("catalog-test:write:widget:approve-x");
    expect(collidingName).toBe(toolNameForQn("catalog-test:write:widget:approve--x"));

    const matches = catalog.tools.filter((t) => t.name === collidingName);
    expect(matches).toHaveLength(1);
    // manifest.handlers is qn-sorted; "approve--x" < "approve-x" by code point (the extra
    // "-" beats "x" at the first differing position), so it's added first and wins the name.
    expect(catalog.dispatchTable.get(collidingName)).toMatchObject({
      qn: "catalog-test:write:widget:approve--x",
    });
  });
});

describe("buildToolCatalog — client tools", () => {
  test("navigate maps the entity's detailFor screen and lists every manifest screen id", () => {
    const catalog = buildCatalog(ADMIN);
    const descriptor = catalog.dispatchTable.get("navigate");
    expect(descriptor?.kind).toBe("client");
    if (descriptor?.kind !== "client" || descriptor.op !== "navigate")
      throw new Error("wrong kind");
    // Screen ids in the manifest are feature-qualified ("<feature>:screen:<id>") —
    // see registry-ingest.ts's populateScreensNavWorkspaces, which overwrites the
    // feature-local short id with the qualified name before it reaches the registry.
    expect(descriptor.entityScreens.get("widget")).toBe("catalog-test:screen:widget-detail");
    expect(descriptor.screenIds.has("catalog-test:screen:widget-edit")).toBe(true);
    expect(descriptor.screenIds.has("catalog-test:screen:widget-approve-form")).toBe(true);
  });

  test("a screen with agent.expose:false is absent from the navigate enum and from the manifest", () => {
    const feature = defineFeature("exposure-test", (r) => {
      r.screen({
        id: "sysadmin-secrets",
        type: "custom",
        renderer: { react: "stub" },
        description: "Webhook secrets.",
        agent: { expose: false },
      });
      r.screen({
        id: "public-board",
        type: "custom",
        renderer: { react: "stub" },
        description: "Public board.",
      });
    });
    const registry = createRegistry([feature]);
    const manifest = buildAgentManifest(registry, { locale: "en", roles: ["Admin"] });
    const catalog = buildToolCatalog(registry, manifest, { mode: "edit" });

    expect(manifest.screens.map((s) => s.id)).toContain("exposure-test:screen:public-board");
    expect(manifest.screens.map((s) => s.id)).not.toContain(
      "exposure-test:screen:sysadmin-secrets",
    );

    const descriptor = catalog.dispatchTable.get("navigate");
    if (descriptor?.kind !== "client" || descriptor.op !== "navigate")
      throw new Error("wrong kind");
    expect(descriptor.screenIds.has("exposure-test:screen:sysadmin-secrets")).toBe(false);
    expect(descriptor.screenIds.has("exposure-test:screen:public-board")).toBe(true);

    const navTool = catalog.tools.find((t) => t.name === "navigate");
    const schema = navTool?.inputSchema ?? {};
    const properties = isRecord(schema["properties"]) ? schema["properties"] : {};
    const screenIdSchema = isRecord(properties["screenId"]) ? properties["screenId"] : {};
    const enumValues = Array.isArray(screenIdSchema["enum"]) ? screenIdSchema["enum"] : [];
    expect(enumValues).toContain("exposure-test:screen:public-board");
    expect(enumValues).not.toContain("exposure-test:screen:sysadmin-secrets");
  });

  test("a screen without an agent slot stays in the navigate enum", () => {
    const catalog = buildCatalog(ADMIN);
    const descriptor = catalog.dispatchTable.get("navigate");
    if (descriptor?.kind !== "client" || descriptor.op !== "navigate")
      throw new Error("wrong kind");
    // None of catalog-test's screens carry a description either — this is the
    // regression guard against a screen without an `agent` slot silently
    // fail-closing (the way a handler without a description would).
    expect(descriptor.screenIds.has("catalog-test:screen:widget-detail")).toBe(true);
  });

  test("open_form maps the actionForm handler and the entityEdit create/update handlers", () => {
    const catalog = buildCatalog(ADMIN);
    const descriptor = catalog.dispatchTable.get("open_form");
    if (descriptor?.kind !== "client" || descriptor.op !== "open_form")
      throw new Error("wrong kind");
    expect(descriptor.formScreens.get("catalog-test:write:widget:approve")).toBe(
      "catalog-test:screen:widget-approve-form",
    );
    expect(descriptor.formScreens.get("catalog-test:write:widget:create")).toBe(
      "catalog-test:screen:widget-edit",
    );
    expect(descriptor.formScreens.get("catalog-test:write:widget:update")).toBe(
      "catalog-test:screen:widget-edit",
    );
    expect(catalog.tools.map((t) => t.name)).not.toContain("open_form");
  });

  test("ask_user is always present with a fixed schema", () => {
    const catalog = buildCatalog(READER);
    const tool = catalog.tools.find((t) => t.name === "ask_user");
    expect(tool?.inputSchema).toEqual({
      type: "object",
      properties: {
        question: { type: "string" },
        options: { type: "array", items: { type: "string" } },
      },
      required: ["question"],
      additionalProperties: false,
    });
  });
});

describe("buildToolCatalog — built-in client tool names vs. a colliding handler-derived tool", () => {
  test("a handler-derived tool sharing the built-in 'navigate' name wins; the built-in is skipped rather than shadowing it", () => {
    const registry: RegistrySearchView = {
      getAllQueryHandlers: () => new Map<string, never>(),
      getHandlerEntity: () => undefined,
      getEntity: () => undefined,
      getSearchableFields: () => [],
    };
    const manifest: AgentManifest = {
      builtForRoles: ["Admin"],
      features: [],
      entities: [],
      handlers: [
        {
          // toolNameForQn drops the "query" verb segment; a bare 2-segment qn collapses
          // to exactly "navigate" — the same name buildNavigateTool always produces.
          qn: "query:navigate",
          kind: "query",
          description: "A handler that happens to be named like the built-in navigate tool.",
          risk: "low",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
      screens: [],
      navs: [],
      workspaces: [],
      tenantSettings: { locale: "en" },
    };

    const catalog = buildToolCatalog(registry, manifest, { mode: "edit" });

    const matches = catalog.tools.filter((t) => t.name === "navigate");
    expect(matches).toHaveLength(1);
    expect(catalog.dispatchTable.get("navigate")).toEqual({
      kind: "server",
      op: "query",
      qn: "query:navigate",
      risk: "low",
    });
  });
});

describe("toolNameForQn", () => {
  test("drops the verb segment, joins with underscores, sanitizes non-identifier characters", () => {
    expect(toolNameForQn("agent-tools-test-vendor:write:vendor:approve")).toBe(
      "agent_tools_test_vendor_vendor_approve",
    );
  });
});
