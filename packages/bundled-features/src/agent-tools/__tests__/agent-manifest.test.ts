import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createSelectField,
  createTextField,
  defineFeature,
  defineQueryHandler,
  defineWriteHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ReferenceFieldDef, TextFieldDef } from "@cosmicdrift/kumiko-framework/engine/types";
import * as z from "zod";
import { buildAgentManifest } from "../agent-manifest.js";

const gatedEntity = createEntity({
  fields: {
    status: createSelectField({ options: ["draft", "active"] as const, filterable: true }),
    ownerId: { type: "reference", entity: "user" } satisfies ReferenceFieldDef,
    title: createTextField({ searchable: true, personal: false, reason: "technical_reference" }),
    // Raw ResolvedPiiFlags form — the manifest is schema, not rows, so this
    // must never surface a value, only the marker.
    secretNote: { type: "text", pii: true } satisfies TextFieldDef,
  },
});

function buildTestFeature() {
  return defineFeature("agent-manifest-test", (r) => {
    r.entity("widget", gatedEntity);

    r.queryHandler("widget:lookup", z.object({ id: z.string() }), async () => ({}), {
      access: { roles: ["admin", "viewer"] },
      description: "Look up a widget by id.",
    });

    r.writeHandler(
      "widget:archive",
      z.object({ id: z.string() }),
      async () => ({ isSuccess: true, data: {} }),
      {
        access: { roles: ["admin"] },
        description: "Archive a widget.",
      },
    );

    r.queryHandler("widget:undescribed", z.object({ id: z.string() }), async () => ({}), {
      access: { roles: ["admin", "viewer"] },
    });

    r.queryHandler(
      "widget:oddschema",
      z.object({ occurredAt: z.instanceof(Date) }),
      async () => ({}),
      {
        access: { roles: ["admin", "viewer"] },
        description: "Takes a schema z.toJSONSchema cannot express.",
      },
    );
  });
}

const otherEntity = createEntity({
  fields: {
    label: createTextField({ searchable: true, personal: false, reason: "technical_reference" }),
  },
});

// Name sorts alphabetically before "agent-manifest-test" so mount order and
// sort order provably diverge in the determinism test below.
function buildOtherFeature() {
  return defineFeature("aa-other-feature", (r) => {
    r.entity("other", otherEntity);

    r.queryHandler("other:lookup", z.object({ id: z.string() }), async () => ({}), {
      access: { roles: ["admin"] },
      description: "Look up an other by id.",
    });
  });
}

describe("buildAgentManifest", () => {
  test("fail-closed: a handler without description and without agent.expose is never exposed", () => {
    const registry = createRegistry([buildTestFeature()]);
    const admin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });
    const viewer = buildAgentManifest(registry, { locale: "en", roles: ["viewer"] });

    expect(admin.handlers.some((h) => h.qn.endsWith(":undescribed"))).toBe(false);
    expect(viewer.handlers.some((h) => h.qn.endsWith(":undescribed"))).toBe(false);
  });

  test("echoes the roles it was built for, so consumers cannot invent a second role source", () => {
    const registry = createRegistry([buildTestFeature()]);
    const manifest = buildAgentManifest(registry, { locale: "en", roles: ["admin", "viewer"] });
    expect(manifest.builtForRoles).toEqual(["admin", "viewer"]);
  });

  test("role gating: viewer sees the query handler but not the admin-only write handler", () => {
    const registry = createRegistry([buildTestFeature()]);
    const viewer = buildAgentManifest(registry, { locale: "en", roles: ["viewer"] });
    const admin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });

    expect(viewer.handlers.some((h) => h.qn.endsWith(":lookup"))).toBe(true);
    expect(viewer.handlers.some((h) => h.qn.endsWith(":archive"))).toBe(false);
    expect(admin.handlers.some((h) => h.qn.endsWith(":lookup"))).toBe(true);
    expect(admin.handlers.some((h) => h.qn.endsWith(":archive"))).toBe(true);
  });

  test("risk defaults: query defaults to low, write defaults to mid", () => {
    const registry = createRegistry([buildTestFeature()]);
    const admin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });

    const queryHandler = admin.handlers.find((h) => h.qn.endsWith(":lookup"));
    const writeHandler = admin.handlers.find((h) => h.qn.endsWith(":archive"));

    expect(queryHandler?.risk).toBe("low");
    expect(writeHandler?.risk).toBe("mid");
  });

  test("object-form handlers forward description and agent hints into the manifest", () => {
    const feature = defineFeature("agent-object-form", (r) => {
      r.entity("widget", gatedEntity);
      r.writeHandler(
        defineWriteHandler({
          name: "widget:purge",
          schema: z.object({ id: z.string() }),
          access: { roles: ["admin"] },
          description: "Purge a widget.",
          agent: { risk: "high" },
          handler: async () => ({ isSuccess: true, data: {} }),
        }),
      );
      r.queryHandler(
        defineQueryHandler({
          name: "widget:audit",
          schema: z.object({ id: z.string() }),
          access: { roles: ["admin"] },
          description: "Audit a widget.",
          agent: { risk: "high" },
          handler: async () => ({}),
        }),
      );
    });
    const admin = buildAgentManifest(createRegistry([feature]), { locale: "en", roles: ["admin"] });

    expect(admin.handlers.find((h) => h.qn.endsWith(":purge"))?.risk).toBe("high");
    expect(admin.handlers.find((h) => h.qn.endsWith(":audit"))?.risk).toBe("high");
  });

  test("inputSchema is a real JSON Schema derived from the zod schema's properties", () => {
    const registry = createRegistry([buildTestFeature()]);
    const admin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });
    const queryHandler = admin.handlers.find((h) => h.qn.endsWith(":lookup"));

    expect(queryHandler?.inputSchema).toMatchObject({
      type: "object",
      properties: { id: { type: "string" } },
    });
  });

  test("a handler whose schema toJSONSchema cannot express is dropped, others stay", () => {
    const registry = createRegistry([buildTestFeature()]);
    const admin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });

    expect(admin.handlers.some((h) => h.qn.endsWith(":oddschema"))).toBe(false);
    expect(admin.handlers.some((h) => h.qn.endsWith(":lookup"))).toBe(true);
    expect(admin.handlers.some((h) => h.qn.endsWith(":archive"))).toBe(true);
  });

  test("PII field carries only the marker, never a value", () => {
    const registry = createRegistry([buildTestFeature()]);
    const admin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });
    const widget = admin.entities.find((e) => e.name === "widget");
    const secretNote = widget?.fields.find((f) => f.name === "secretNote");

    expect(secretNote).toEqual({
      name: "secretNote",
      type: "text",
      labels: {},
      pii: true,
    });
  });

  test("select field carries its options, reference field carries the referenced entity", () => {
    const registry = createRegistry([buildTestFeature()]);
    const admin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });
    const widget = admin.entities.find((e) => e.name === "widget");

    expect(widget?.fields.find((f) => f.name === "status")).toMatchObject({
      type: "select",
      options: ["draft", "active"],
      filterable: true,
    });
    expect(widget?.fields.find((f) => f.name === "ownerId")).toMatchObject({
      type: "reference",
      references: "user",
    });
    expect(widget?.fields.find((f) => f.name === "title")).toMatchObject({
      type: "text",
      searchable: true,
    });
  });

  test("deterministic: manifest is independent of feature mount order", () => {
    const featureA = buildTestFeature();
    const featureB = buildOtherFeature();
    const registryA = createRegistry([featureA, featureB]);
    const registryB = createRegistry([featureB, featureA]);
    const manifestA = buildAgentManifest(registryA, { locale: "en", roles: ["admin"] });
    const manifestB = buildAgentManifest(registryB, { locale: "en", roles: ["admin"] });

    expect(manifestA).toEqual(manifestB);

    const qns = manifestA.handlers.map((h) => h.qn);
    expect(qns).toEqual([...qns].sort());

    const entityNames = manifestA.entities.map((e) => e.name);
    expect(entityNames).toEqual([...entityNames].sort());
  });

  test("a nav pointing at an opted-out screen is dropped too, so the screen id never leaks via navs", () => {
    const feature = defineFeature("nav-leak-test", (r) => {
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
      r.nav({
        id: "sysadmin-secrets",
        label: "nav-leak-test:nav:sysadmin-secrets",
        screen: "nav-leak-test:screen:sysadmin-secrets",
      });
      r.nav({
        id: "public-board",
        label: "nav-leak-test:nav:public-board",
        screen: "nav-leak-test:screen:public-board",
      });
    });

    const manifest = buildAgentManifest(createRegistry([feature]), {
      locale: "en",
      roles: ["admin"],
    });

    expect(manifest.navs.map((n) => n.screen)).toEqual(["nav-leak-test:screen:public-board"]);
    expect(manifest.screens.map((s) => s.id)).toEqual(["nav-leak-test:screen:public-board"]);
  });

  test("a child nav under a parent hidden from the role is dropped with its screen", () => {
    const feature = defineFeature("nav-parent", (r) => {
      r.screen({
        id: "child-board",
        type: "custom",
        renderer: { react: "stub" },
        description: "Child board.",
      });
      r.nav({
        id: "admin-root",
        label: "nav-parent:nav:admin-root",
        access: { roles: ["admin"] },
      });
      r.nav({
        id: "child",
        label: "nav-parent:nav:child",
        parent: "nav-parent:nav:admin-root",
        screen: "nav-parent:screen:child-board",
      });
    });
    const registry = createRegistry([feature]);

    const asAdmin = buildAgentManifest(registry, { locale: "en", roles: ["admin"] });
    const asViewer = buildAgentManifest(registry, { locale: "en", roles: ["viewer"] });

    expect(asAdmin.navs.map((n) => n.id)).toEqual([
      "nav-parent:nav:admin-root",
      "nav-parent:nav:child",
    ]);
    expect(asViewer.navs).toEqual([]);
    expect(asViewer.screens.map((s) => s.id)).toEqual([]);
  });

  test("a screen description that is an i18n key resolves to its English prose, not the raw key", () => {
    const feature = defineFeature("i18n-description-test", (r) => {
      r.translations({
        keys: { "i18n-description-test.subtitle": { en: "Prose the agent should see." } },
      });
      r.screen({
        id: "with-i18n-description",
        type: "custom",
        renderer: { react: "stub" },
        description: "i18n-description-test.subtitle",
      });
      r.screen({
        id: "with-literal-description",
        type: "custom",
        renderer: { react: "stub" },
        description: "Literal, never registered as a key.",
      });
    });

    const manifest = buildAgentManifest(createRegistry([feature]), {
      locale: "en",
      roles: ["admin"],
    });

    const withKey = manifest.screens.find((s) => s.id.endsWith("with-i18n-description"));
    const withLiteral = manifest.screens.find((s) => s.id.endsWith("with-literal-description"));
    expect(withKey?.description).toBe("Prose the agent should see.");
    expect(withLiteral?.description).toBe("Literal, never registered as a key.");
  });
  test("a detail screen reports its configured idParam, defaulting to id", () => {
    const feature = defineFeature("detail-param-test", (r) => {
      r.screen({
        id: "by-slug",
        type: "projectionDetail",
        query: "detail-param-test:query:thing:details",
        idParam: "slug",
        detailFor: "thing",
        layout: { sections: [{ fields: ["name"] }] },
      });
      r.screen({
        id: "by-default",
        type: "projectionDetail",
        query: "detail-param-test:query:other:details",
        detailFor: "other",
        layout: { sections: [{ fields: ["name"] }] },
      });
    });

    const manifest = buildAgentManifest(createRegistry([feature]), {
      locale: "en",
      roles: ["admin"],
    });

    expect(manifest.screens.find((s) => s.id.endsWith("by-slug"))?.params).toEqual(["slug"]);
    expect(manifest.screens.find((s) => s.id.endsWith("by-default"))?.params).toEqual(["id"]);
  });

  test("entity and field labels resolve via suffix match, first registered key wins", () => {
    const feature = defineFeature("label-suffix-test", (r) => {
      r.entity("widget", gatedEntity);
      r.translations({
        keys: {
          "label-suffix-test:entity:widget": { en: "Widget" },
          "label-suffix-test:entity:widget:field:title": { en: "Title" },
        },
      });
    });

    const manifest = buildAgentManifest(createRegistry([feature]), {
      locale: "en",
      roles: ["admin"],
    });

    const widget = manifest.entities.find((e) => e.name === "widget");
    expect(widget?.labels["en"]).toBe("Widget");
    expect(widget?.fields.find((f) => f.name === "title")?.labels["en"]).toBe("Title");
    expect(widget?.fields.find((f) => f.name === "status")?.labels).toEqual({});
  });
});

describe("screen titles with a shared short id", () => {
  const featureWithSettingsScreen = (name: string, title: string) =>
    defineFeature(name, (r) => {
      r.translations({ keys: { "screen:settings.title": { en: title } } });
      r.screen({ id: "settings", type: "custom", renderer: { react: "stub" } });
    });

  test.each([
    ["a then b", ["title-a", "title-b"]],
    ["b then a", ["title-b", "title-a"]],
  ])("each screen keeps its own feature's title regardless of mount order (%s)", (_, order) => {
    const features = order.map((name) => featureWithSettingsScreen(name, `Title of ${name}`));
    const manifest = buildAgentManifest(createRegistry(features), {
      locale: "en",
      roles: ["admin"],
    });
    for (const name of order) {
      const screen = manifest.screens.find((s) => s.id === `${name}:screen:settings`);
      expect(screen?.titles["en"]).toBe(`Title of ${name}`);
    }
  });
});

describe("buildAgentManifest: excludeFields of generic create/update handlers", () => {
  const ticketEntity = createEntity({
    fields: {
      title: createTextField({ personal: false, reason: "technical_reference" }),
      status: createTextField({ personal: false, reason: "technical_reference" }),
    },
  });
  const feature = defineFeature("agent-exclude-fields", (r) => {
    r.crud("ticket", ticketEntity, {
      write: { access: { roles: ["admin"] } },
      excludeFields: { update: ["status"] },
      descriptions: {
        create: "Create a ticket.",
        update: "Update a ticket.",
        delete: "Delete a ticket.",
      },
      verbs: { list: false, detail: false, restore: false },
    });
  });
  const handlers = buildAgentManifest(createRegistry([feature]), {
    locale: "en",
    roles: ["admin"],
  }).handlers;
  const entryFor = (verb: string) =>
    handlers.find((h) => h.qn === `agent-exclude-fields:write:ticket:${verb}`);

  test("the update entry names the fields the agent must not send", () => {
    expect(entryFor("update")?.excludedFields).toEqual(["status"]);
  });

  test("entries without exclusions stay unchanged", () => {
    expect(entryFor("create")).toBeDefined();
    expect(entryFor("create")).not.toHaveProperty("excludedFields");
    expect(entryFor("delete")).not.toHaveProperty("excludedFields");
  });
});
