import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createRegistry,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ReferenceFieldDef, TextFieldDef } from "@cosmicdrift/kumiko-framework/engine/types";
import { z } from "zod";
import { buildAgentManifest } from "../agent-manifest";

const gatedEntity = createEntity({
  fields: {
    status: createSelectField({ options: ["draft", "active"] as const, filterable: true }),
    ownerId: { type: "reference", entity: "user" } satisfies ReferenceFieldDef,
    title: createTextField({ searchable: true }),
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
    label: createTextField({ searchable: true }),
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
});
