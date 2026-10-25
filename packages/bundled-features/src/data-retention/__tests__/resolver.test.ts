// Unit tests for resolveRetentionPolicy — pure function, no
// test-stack dependency.

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";
import { resolveRetentionPolicy } from "../resolver.ts";

describe("resolveRetentionPolicy — Layer-Resolution", () => {
  test("Layer 1 Entity-Default applies when neither preset nor override is present", () => {
    const entity = createEntity({
      fields: { foo: createTextField({ personal: false, reason: "technical_reference" }) },
      retention: { keepFor: "30d", strategy: "hardDelete", reference: "createdAt" },
    });

    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: entity,
      tenantPreset: null,
      tenantOverride: null,
    });

    expect(result.source).toBe("entity-default");
    expect(result.policy).toEqual({
      keepFor: "30d",
      strategy: "hardDelete",
      reference: "createdAt",
    });
  });

  test("Layer 2 preset overrides Entity-Default", () => {
    const entity = createEntity({
      fields: { foo: createTextField({ personal: false, reason: "technical_reference" }) },
      retention: { keepFor: "7d", strategy: "hardDelete" },
    });

    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: entity,
      tenantPreset: "dsgvo-basic",
      tenantOverride: null,
    });

    expect(result.source).toBe("preset");
    // dsgvo-basic.session = 30d / hardDelete / lastSeenAt
    expect(result.policy?.keepFor).toBe("30d");
    expect(result.policy?.reference).toBe("lastSeenAt");
  });

  test("Layer 3 override completely overrides preset", () => {
    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: null,
      tenantPreset: "dsgvo-basic",
      tenantOverride: { keepFor: "7d", strategy: "hardDelete" },
    });

    expect(result.source).toBe("override");
    expect(result.policy?.keepFor).toBe("7d");
  });

  test("Override with only keepFor inherits strategy/reference from preset", () => {
    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: null,
      tenantPreset: "dsgvo-basic",
      tenantOverride: { keepFor: "60d" },
    });

    expect(result.source).toBe("override");
    expect(result.policy?.keepFor).toBe("60d");
    // Aus dsgvo-basic.session geerbt:
    expect(result.policy?.strategy).toBe("hardDelete");
    expect(result.policy?.reference).toBe("lastSeenAt");
  });

  test("Entity without retention + no preset + no override → policy=null + source=none", () => {
    const entity = createEntity({
      fields: { foo: createTextField({ personal: false, reason: "technical_reference" }) },
    });

    const result = resolveRetentionPolicy({
      entityName: "ticket",
      entityDef: entity,
      tenantPreset: "dsgvo-basic", // has no "ticket" entry
      tenantOverride: null,
    });

    expect(result.source).toBe("none");
    expect(result.policy).toBeNull();
  });

  test("dsgvo-hgb invoice is blockDelete 10y (retention obligation)", () => {
    const result = resolveRetentionPolicy({
      entityName: "invoice",
      entityDef: null,
      tenantPreset: "dsgvo-hgb",
      tenantOverride: null,
    });

    expect(result.source).toBe("preset");
    expect(result.policy?.keepFor).toBe("10y");
    expect(result.policy?.strategy).toBe("blockDelete");
  });

  test("dsgvo-hgb order is anonymize 6y (Order-PII removed, business data remains)", () => {
    const result = resolveRetentionPolicy({
      entityName: "order",
      entityDef: null,
      tenantPreset: "dsgvo-hgb",
      tenantOverride: null,
    });

    expect(result.source).toBe("preset");
    expect(result.policy?.keepFor).toBe("6y");
    expect(result.policy?.strategy).toBe("anonymize");
  });

  test("Override for law firm: caseFile 6y blockDelete (not in preset)", () => {
    const result = resolveRetentionPolicy({
      entityName: "caseFile",
      entityDef: null,
      tenantPreset: "dsgvo-basic",
      tenantOverride: { keepFor: "6y", strategy: "blockDelete", reference: "closedAt" },
    });

    expect(result.source).toBe("override");
    expect(result.policy).toEqual({
      keepFor: "6y",
      strategy: "blockDelete",
      reference: "closedAt",
    });
  });
});

describe("resolveRetentionPolicy — override-incomplete-Guard", () => {
  test("Override without keepFor + no base → policy=null, source=override-incomplete", () => {
    const result = resolveRetentionPolicy({
      entityName: "ticket",
      entityDef: null,
      tenantPreset: "dsgvo-basic", // has no "ticket" entry
      tenantOverride: { strategy: "hardDelete" }, // keepFor is missing
    });

    expect(result.source).toBe("override-incomplete");
    expect(result.policy).toBeNull();
  });

  test("Override without strategy + no base → policy=null, source=override-incomplete", () => {
    const result = resolveRetentionPolicy({
      entityName: "ticket",
      entityDef: null,
      tenantPreset: null,
      tenantOverride: { keepFor: "30d" },
    });

    expect(result.source).toBe("override-incomplete");
    expect(result.policy).toBeNull();
  });

  test("Override without keepFor but preset has one → falls back + source=override", () => {
    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: null,
      tenantPreset: "dsgvo-basic", // session: 30d
      tenantOverride: { strategy: "softDelete" }, // keepFor is inherited from the preset
    });

    expect(result.source).toBe("override");
    expect(result.policy?.keepFor).toBe("30d");
    expect(result.policy?.strategy).toBe("softDelete");
  });
});

describe("resolveRetentionPolicy — Edge-Cases", () => {
  test("default-Preset is empty → falls back to entity-default", () => {
    const entity = createEntity({
      fields: { foo: createTextField({ personal: false, reason: "technical_reference" }) },
      retention: { keepFor: "30d", strategy: "hardDelete" },
    });

    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: entity,
      tenantPreset: "default",
      tenantOverride: null,
    });

    expect(result.source).toBe("entity-default");
  });

  test("Preset has an entry, override has a different entityName → override applies ONLY to its entityName", () => {
    const result = resolveRetentionPolicy({
      entityName: "audit-log",
      entityDef: null,
      tenantPreset: "dsgvo-hgb",
      tenantOverride: null, // no override for audit-log
    });

    // dsgvo-hgb["audit-log"] = 1y / hardDelete
    expect(result.source).toBe("preset");
    expect(result.policy?.keepFor).toBe("1y");
  });
});
