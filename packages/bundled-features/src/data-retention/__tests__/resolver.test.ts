// Unit-Tests für resolveRetentionPolicy — pure function, keine
// Test-Stack-Abhängigkeit.

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "@cosmicdrift/kumiko-framework/engine";
import { resolveRetentionPolicy } from "../resolver";

describe("resolveRetentionPolicy — Layer-Resolution", () => {
  test("Layer 1 Entity-Default greift wenn weder Preset noch Override", () => {
    const entity = createEntity({
      fields: { foo: createTextField() },
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

  test("Layer 2 Preset überschreibt Entity-Default", () => {
    const entity = createEntity({
      fields: { foo: createTextField() },
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

  test("Layer 3 Override überschreibt Preset komplett", () => {
    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: null,
      tenantPreset: "dsgvo-basic",
      tenantOverride: { keepFor: "7d", strategy: "hardDelete" },
    });

    expect(result.source).toBe("override");
    expect(result.policy?.keepFor).toBe("7d");
  });

  test("Override mit nur keepFor übernimmt strategy/reference vom Preset", () => {
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

  test("Entity ohne retention + kein Preset + kein Override → policy=null + source=none", () => {
    const entity = createEntity({ fields: { foo: createTextField() } });

    const result = resolveRetentionPolicy({
      entityName: "ticket",
      entityDef: entity,
      tenantPreset: "dsgvo-basic", // hat kein "ticket" drin
      tenantOverride: null,
    });

    expect(result.source).toBe("none");
    expect(result.policy).toBeNull();
  });

  test("dsgvo-hgb invoice ist blockDelete 10y (Aufbewahrungspflicht)", () => {
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

  test("dsgvo-hgb order ist anonymize 6y (Order-PII raus, Geschäftsdaten bleiben)", () => {
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

  test("Override für Anwaltskanzlei: caseFile 6y blockDelete (nicht im Preset)", () => {
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
  test("Override ohne keepFor + keine Base → policy=null, source=override-incomplete", () => {
    const result = resolveRetentionPolicy({
      entityName: "ticket",
      entityDef: null,
      tenantPreset: "dsgvo-basic", // hat kein "ticket"
      tenantOverride: { strategy: "hardDelete" }, // keepFor fehlt
    });

    expect(result.source).toBe("override-incomplete");
    expect(result.policy).toBeNull();
  });

  test("Override ohne strategy + keine Base → policy=null, source=override-incomplete", () => {
    const result = resolveRetentionPolicy({
      entityName: "ticket",
      entityDef: null,
      tenantPreset: null,
      tenantOverride: { keepFor: "30d" },
    });

    expect(result.source).toBe("override-incomplete");
    expect(result.policy).toBeNull();
  });

  test("Override ohne keepFor aber Preset hat ein → fällt zurück + source=override", () => {
    const result = resolveRetentionPolicy({
      entityName: "session",
      entityDef: null,
      tenantPreset: "dsgvo-basic", // session: 30d
      tenantOverride: { strategy: "softDelete" }, // keepFor erbt von Preset
    });

    expect(result.source).toBe("override");
    expect(result.policy?.keepFor).toBe("30d");
    expect(result.policy?.strategy).toBe("softDelete");
  });
});

describe("resolveRetentionPolicy — Edge-Cases", () => {
  test("default-Preset ist leer → fällt zurück auf entity-default", () => {
    const entity = createEntity({
      fields: { foo: createTextField() },
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

  test("Preset hat eintrag, override hat anderen entityName → override greift NUR für seinen entityName", () => {
    const result = resolveRetentionPolicy({
      entityName: "audit-log",
      entityDef: null,
      tenantPreset: "dsgvo-hgb",
      tenantOverride: null, // kein override für audit-log
    });

    // dsgvo-hgb["audit-log"] = 1y / hardDelete
    expect(result.source).toBe("preset");
    expect(result.policy?.keepFor).toBe("1y");
  });
});
