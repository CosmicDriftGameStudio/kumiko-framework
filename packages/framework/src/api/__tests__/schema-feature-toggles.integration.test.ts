// GET /api/schema must not advertise screens/navs of features the caller's
// tenant has switched off (r.toggleable) — their handlers all answer 403
// feature_disabled, so the nav entry would lead nowhere.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createEntity, defineFeature } from "../../engine/index.ts";
import type { TenantId } from "../../engine/types/identifiers.ts";
import { createTestUser } from "../../seeding/seed-users.ts";
import { Routes } from "../api-constants.ts";

const SCHEMA_PATH = `/api${Routes.schema}`;
const TENANT_WITHOUT_ADDON = "00000000-0000-4000-8000-0000000000a1" as TenantId;
const TENANT_IN_TRIAL = "00000000-0000-4000-8000-0000000000a4" as TenantId;
const TENANT_WITH_ADDON = "00000000-0000-4000-8000-0000000000a2" as TenantId;
const ADDON_FEATURE = "toggle-addon";

const coreFeature = defineFeature("toggle-core", (r) => {
  r.entity({ name: "note", ...createEntity({ fields: {} }) });
  r.screen({
    id: "note-list",
    type: "entityList",
    entity: "note",
    columns: ["id"],
    rowActions: [
      { kind: "navigate", id: "open-gadget", label: "Open gadget", screen: "gadget-list" },
    ],
  });
  r.nav({ id: "note-list", label: "Notes", screen: "note-list" });
  r.nav({
    id: "note-under-gadget",
    label: "Notes under gadgets",
    screen: "note-list",
    parent: `${ADDON_FEATURE}:nav:gadget-list`,
  });
  r.nav({
    id: "note-under-note-under-gadget",
    label: "Notes two levels below gadgets",
    screen: "note-list",
    parent: "toggle-core:nav:note-under-gadget",
  });
  r.workspace({
    id: "core-ws",
    label: "Core workspace",
    nav: ["toggle-core:nav:note-list", `${ADDON_FEATURE}:nav:gadget-list`],
  });
});

const addonFeature = defineFeature(ADDON_FEATURE, (r) => {
  r.toggleable({ default: false });
  r.entity({ name: "gadget", ...createEntity({ fields: {} }) });
  r.screen({ id: "gadget-list", type: "entityList", entity: "gadget", columns: ["id"] });
  r.nav({ id: "gadget-list", label: "Gadgets", screen: "gadget-list" });
  r.contentCollection({ id: "gadget-templates", kind: "mail", nav: { label: "Gadget templates" } });
  r.workspace({
    id: "gadget-ws",
    label: "Gadget workspace",
    nav: [`${ADDON_FEATURE}:nav:gadget-list`],
  });
});

type SchemaBody = {
  features: Array<{
    featureName: string;
    screens: Array<{ id: string; rowActions?: Array<{ id: string }> }>;
    navs?: Array<{ id: string; parent?: string }>;
    contentCollections?: Array<{ id: string }>;
  }>;
  workspaces?: Array<{ definition: { id: string }; navMembers: string[] }>;
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [coreFeature, addonFeature],
    effectiveFeatures: Object.assign(
      (tenantId: TenantId): ReadonlySet<string> => {
        const all = new Set<string>(stack.registry.features.keys());
        if (tenantId !== TENANT_WITH_ADDON) all.delete(ADDON_FEATURE);
        return all;
      },
      {
        trialGate: (tenantId: TenantId, featureName: string): Promise<boolean> =>
          Promise.resolve(tenantId === TENANT_IN_TRIAL && featureName === ADDON_FEATURE),
      },
    ),
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function fetchSchema(tenantId: TenantId): Promise<{ body: SchemaBody; etag: string }> {
  const token = await stack.jwt.sign(createTestUser({ tenantId, roles: ["User"] }));
  const res = await stack.app.request(SCHEMA_PATH, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  return { body: (await res.json()) as SchemaBody, etag: res.headers.get("etag") ?? "" };
}

function addonSchemaOf(body: SchemaBody): SchemaBody["features"][number] | undefined {
  return body.features.find((f) => f.featureName === ADDON_FEATURE);
}

describe("GET /api/schema with r.toggleable features", () => {
  test("tenant without the add-on gets no screens or navs of it", async () => {
    const { body } = await fetchSchema(TENANT_WITHOUT_ADDON);
    const addon = addonSchemaOf(body);
    expect(addon?.screens ?? []).toEqual([]);
    expect(addon?.navs ?? []).toEqual([]);
    const core = body.features.find((f) => f.featureName === "toggle-core");
    expect(core?.screens.map((s) => s.id)).toEqual(["note-list"]);
    expect(core?.navs?.map((n) => n.id)).toEqual(["note-list"]);
  });

  test("references from enabled features to the disabled feature's screens and navs are removed", async () => {
    const { body } = await fetchSchema(TENANT_WITHOUT_ADDON);
    const core = body.features.find((f) => f.featureName === "toggle-core");
    expect(core?.screens[0]?.rowActions).toBeUndefined();
    expect(core?.navs?.some((n) => n.id === "note-under-gadget")).toBe(false);
  });

  test("the disabled feature's workspaces and content collections are removed", async () => {
    const { body } = await fetchSchema(TENANT_WITHOUT_ADDON);
    expect(addonSchemaOf(body)?.contentCollections ?? []).toEqual([]);
    expect(body.workspaces?.map((ws) => ws.definition.id)).toEqual(["core-ws"]);
  });

  test("an enabled workspace loses members that point at the disabled feature's navs", async () => {
    const { body } = await fetchSchema(TENANT_WITHOUT_ADDON);
    const coreWorkspace = body.workspaces?.find((ws) => ws.definition.id === "core-ws");
    expect(coreWorkspace?.navMembers).toEqual(["toggle-core:nav:note-list"]);
  });

  test("a nav chain from enabled navs down to a disabled nav is removed completely", async () => {
    const { body } = await fetchSchema(TENANT_WITHOUT_ADDON);
    const core = body.features.find((f) => f.featureName === "toggle-core");
    expect(core?.navs?.map((n) => n.id)).toEqual(["note-list"]);
  });

  test("tenant with the add-on keeps workspaces, content collections and the nav chain", async () => {
    const { body } = await fetchSchema(TENANT_WITH_ADDON);
    expect(addonSchemaOf(body)?.contentCollections?.map((c) => c.id)).toEqual(["gadget-templates"]);
    expect(body.workspaces?.map((ws) => ws.definition.id).sort()).toEqual(["core-ws", "gadget-ws"]);
    expect(body.workspaces?.find((ws) => ws.definition.id === "core-ws")?.navMembers).toContain(
      `${ADDON_FEATURE}:nav:gadget-list`,
    );
    const core = body.features.find((f) => f.featureName === "toggle-core");
    expect(core?.navs?.some((n) => n.id === "note-under-note-under-gadget")).toBe(true);
  });

  test("tenant with the add-on keeps those references", async () => {
    const { body } = await fetchSchema(TENANT_WITH_ADDON);
    const core = body.features.find((f) => f.featureName === "toggle-core");
    expect(core?.screens[0]?.rowActions?.map((a) => a.id)).toEqual(["open-gadget"]);
    expect(core?.navs?.some((n) => n.id === "note-under-gadget")).toBe(true);
  });

  test("tenant whose trial unlocks the add-on gets it although the resolver reports it off", async () => {
    const { body } = await fetchSchema(TENANT_IN_TRIAL);
    const addon = addonSchemaOf(body);
    expect(addon?.screens.map((s) => s.id)).toEqual(["gadget-list"]);
    expect(addon?.navs?.map((n) => n.id)).toEqual(["gadget-list", "gadget-templates"]);
  });

  test("tenant with the add-on gets its screens and navs, under a different ETag", async () => {
    const without = await fetchSchema(TENANT_WITHOUT_ADDON);
    const withAddon = await fetchSchema(TENANT_WITH_ADDON);
    const addon = addonSchemaOf(withAddon.body);
    expect(addon?.screens.map((s) => s.id)).toEqual(["gadget-list"]);
    expect(addon?.navs?.map((n) => n.id)).toEqual(["gadget-list", "gadget-templates"]);
    expect(withAddon.etag).not.toBe(without.etag);
  });

  test("tenants with the same disabled set share one ETag", async () => {
    const other = "00000000-0000-4000-8000-0000000000a3" as TenantId;
    const first = await fetchSchema(TENANT_WITHOUT_ADDON);
    const second = await fetchSchema(other);
    expect(second.etag).toBe(first.etag);
  });
});
