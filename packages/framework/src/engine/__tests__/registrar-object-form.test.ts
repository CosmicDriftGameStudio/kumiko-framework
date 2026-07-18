import { describe, expect, test } from "bun:test";
import { defineFeature } from "../index";

// Object-Form is the shape the feature-ast renderer emits for Designer/
// AI-generated code (`r.entity({ name: "item", ... })` instead of
// `r.entity("item", { ... })`) — see kumiko-framework#1113. The compile
// checks in feature-ast/__tests__/render-roundtrip.test.ts prove the TYPES
// line up; they never execute the runtime dispatch that unpacks Object-Form
// back into the same state mutations as the positional form. These tests
// cover that: one per distinct dispatch shape, asserting object-form and
// positional-form produce identical FeatureDefinition state.

describe("registrar Object-Form — runtime parity with positional form", () => {
  test("requires: array-unwrap ({ features }) matches variadic-string form", () => {
    const positional = defineFeature("a", (r) => {
      r.requires("auth", "tenant");
    });
    const objectForm = defineFeature("b", (r) => {
      r.requires({ features: ["auth", "tenant"] });
    });
    expect(objectForm.requires).toEqual(positional.requires);
  });

  test("optionalRequires: array-unwrap matches variadic-string form", () => {
    const positional = defineFeature("a", (r) => {
      r.optionalRequires("promotions");
    });
    const objectForm = defineFeature("b", (r) => {
      r.optionalRequires({ features: ["promotions"] });
    });
    expect(objectForm.optionalRequires).toEqual(positional.optionalRequires);
  });

  test("readsConfig: array-unwrap ({ keys }) matches variadic-string form", () => {
    const positional = defineFeature("a", (r) => {
      r.readsConfig("auth.smtpHost");
    });
    const objectForm = defineFeature("b", (r) => {
      r.readsConfig({ keys: ["auth.smtpHost"] });
    });
    expect(objectForm.configReads).toEqual(positional.configReads);
  });

  test("entity: split-name ({ name, ...fields }) matches (name, definition) form", () => {
    const definition = { fields: { title: { type: "text" as const, required: true } } };
    const positional = defineFeature("a", (r) => {
      r.entity("item", definition);
    });
    const objectForm = defineFeature("b", (r) => {
      r.entity({ name: "item", ...definition });
    });
    expect(objectForm.entities).toEqual(positional.entities);
  });

  test("metric: split-name matches (shortName, options) form", () => {
    const positional = defineFeature("a", (r) => {
      r.metric("created", { type: "counter" });
    });
    const objectForm = defineFeature("b", (r) => {
      r.metric({ name: "created", type: "counter" });
    });
    expect(objectForm.metrics).toEqual(positional.metrics);
  });

  test("secret: split-name matches (shortName, options) form (same feature name for qualifiedName parity)", () => {
    const positional = defineFeature("stripe", (r) => {
      r.secret("apiKey", { label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    const objectForm = defineFeature("stripe", (r) => {
      r.secret({ name: "apiKey", label: { en: "Stripe API Key" }, scope: "tenant" });
    });
    expect(objectForm.secretKeys).toEqual(positional.secretKeys);
  });

  test("relation: two-field ({ entity, name, ...def }) matches (entity, name, definition) form", () => {
    const definition = { type: "belongsTo" as const, target: "user", foreignKey: "supplierId" };
    const positional = defineFeature("a", (r) => {
      r.entity("item", { fields: {} });
      r.relation("item", "supplier", definition);
    });
    const objectForm = defineFeature("b", (r) => {
      r.entity("item", { fields: {} });
      r.relation({ entity: "item", name: "supplier", ...definition });
    });
    expect(objectForm.relations).toEqual(positional.relations);
  });

  test("referenceData: two-field ({ entity, data, ...opts }) matches (entity, data, options) form", () => {
    const data = [{ id: "a", label: "A" }];
    const positional = defineFeature("a", (r) => {
      r.referenceData("category", data, { upsertKey: "id" });
    });
    const objectForm = defineFeature("b", (r) => {
      r.referenceData({ entity: "category", data, upsertKey: "id" });
    });
    expect(objectForm.referenceData).toEqual(positional.referenceData);
  });

  test("useExtension: two-field ({ name, entity, ...opts }) matches (extensionName, entity, options) form", () => {
    const positional = defineFeature("a", (r) => {
      r.useExtension("audit-log", "item", { verbose: true });
    });
    const objectForm = defineFeature("b", (r) => {
      r.useExtension({ name: "audit-log", entity: "item", verbose: true });
    });
    expect(objectForm.extensionUsages).toEqual(positional.extensionUsages);
  });

  test("claimKey: generic split-name matches (shortName, options) form", () => {
    const positional = defineFeature("drivers", (r) => {
      r.claimKey("teamId", { type: "string" });
    });
    const objectForm = defineFeature("drivers", (r) => {
      r.claimKey({ name: "teamId", type: "string" });
    });
    expect(objectForm.claimKeys).toEqual(positional.claimKeys);
  });

  test("job: full-definition object matches (name, options, handler) form", () => {
    const handler = async () => {};
    const positional = defineFeature("a", (r) => {
      r.job("reconcile", { trigger: { manual: true } }, handler);
    });
    const objectForm = defineFeature("b", (r) => {
      r.job({ name: "reconcile", trigger: { manual: true }, handler });
    });
    expect(objectForm.jobs).toEqual(positional.jobs);
  });

  test("notification: split-name matches (name, definition) form", () => {
    const recipient = () => null;
    const data = () => ({});
    const positional = defineFeature("a", (r) => {
      r.notification("itemLowStock", { trigger: { on: "item:lowStock" }, recipient, data });
    });
    const objectForm = defineFeature("b", (r) => {
      r.notification({ name: "itemLowStock", trigger: { on: "item:lowStock" }, recipient, data });
    });
    expect(objectForm.notifications).toEqual(positional.notifications);
  });
});
