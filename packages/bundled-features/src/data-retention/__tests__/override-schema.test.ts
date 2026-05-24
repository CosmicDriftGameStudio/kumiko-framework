// Tests fuer retentionOverrideSchema (S2.D2.5 M2+M3) — strict-Zod
// faengt Sub-Level-Tippfehler + Strategy-Enum-Drift + keepFor-Format-Drift.

import { describe, expect, test } from "bun:test";
import { retentionOverrideSchema } from "../override-schema";

describe("retentionOverrideSchema — accept-Faelle", () => {
  test("Empty Object ist valid (alle Felder optional, Resolver-Fallback)", () => {
    const result = retentionOverrideSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("Nur keepFor — ist valid", () => {
    const result = retentionOverrideSchema.safeParse({ keepFor: "30d" });
    expect(result.success).toBe(true);
  });

  test("keepFor + strategy + reference komplett", () => {
    const result = retentionOverrideSchema.safeParse({
      keepFor: "10y",
      strategy: "blockDelete",
      reference: "completedAt",
    });
    expect(result.success).toBe(true);
  });

  test("Alle 4 strategy-Werte akzeptiert", () => {
    for (const strategy of ["hardDelete", "softDelete", "anonymize", "blockDelete"]) {
      const result = retentionOverrideSchema.safeParse({ strategy });
      expect(result.success).toBe(true);
    }
  });

  test("Verschiedene keepFor-Formate (h/d/w/m/y)", () => {
    for (const keepFor of ["24h", "30d", "1w", "6m", "10y"]) {
      const result = retentionOverrideSchema.safeParse({ keepFor });
      expect(result.success).toBe(true);
    }
  });
});

describe("retentionOverrideSchema — reject-Faelle (Drift-Schutz)", () => {
  test('M3: strategy: "delete" wird rejected (kein gueltiger Strategy-Wert)', () => {
    const result = retentionOverrideSchema.safeParse({ strategy: "delete" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["strategy"]);
    }
  });

  test('strategy: "anonymise" (UK-Spelling) rejected', () => {
    const result = retentionOverrideSchema.safeParse({ strategy: "anonymise" });
    expect(result.success).toBe(false);
  });

  test("Top-Level-Tippfehler keepfor (lowercase) rejected via .strict()", () => {
    const result = retentionOverrideSchema.safeParse({ keepfor: "30d" });
    expect(result.success).toBe(false);
    if (!result.success) {
      // strict() reportet unrecognized_keys
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  test('keepFor-Format-Drift "30days" rejected via regex', () => {
    const result = retentionOverrideSchema.safeParse({ keepFor: "30days" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["keepFor"]);
    }
  });

  test("keepFor leerer String rejected", () => {
    const result = retentionOverrideSchema.safeParse({ keepFor: "" });
    expect(result.success).toBe(false);
  });

  test("keepFor nur Zahl ohne Suffix rejected", () => {
    const result = retentionOverrideSchema.safeParse({ keepFor: "30" });
    expect(result.success).toBe(false);
  });

  test("reference leerer String rejected", () => {
    const result = retentionOverrideSchema.safeParse({ reference: "" });
    expect(result.success).toBe(false);
  });

  test("Unbekanntes Top-Level-Property rejected (extraField)", () => {
    const result = retentionOverrideSchema.safeParse({
      keepFor: "30d",
      strategy: "hardDelete",
      extraField: "noise",
    });
    expect(result.success).toBe(false);
  });
});
