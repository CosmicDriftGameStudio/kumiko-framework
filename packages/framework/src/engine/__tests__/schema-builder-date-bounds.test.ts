// #369: min/max auf date/timestamp-Feldern werden im Insert-Schema
// durchgesetzt (lexikografischer ISO-Vergleich, ohne Date-API). Die UI
// begrenzt den Picker; diese Zod-Grenze ist die Write-seitige Sicherung.

import { describe, expect, test } from "bun:test";
import { createDateField, createEntity, createTimestampField } from "../factories";
import { buildInsertSchema } from "../schema-builder";

describe("date/timestamp min/max bounds", () => {
  test("date max abgewiesen, im Rahmen akzeptiert", () => {
    const entity = createEntity({
      table: "T",
      fields: { born: createDateField({ max: "2026-06-15" }) },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ born: "2026-01-01" }).success).toBe(true);
    expect(schema.safeParse({ born: "2026-12-31" }).success).toBe(false);
  });

  test("date min abgewiesen, im Rahmen akzeptiert", () => {
    const entity = createEntity({
      table: "T",
      fields: { d: createDateField({ min: "2026-01-01" }) },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ d: "2026-05-05" }).success).toBe(true);
    expect(schema.safeParse({ d: "2025-12-31" }).success).toBe(false);
  });

  test("ohne bounds: jedes valide Datum passt", () => {
    const entity = createEntity({ table: "T", fields: { d: createDateField() } });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ d: "1999-01-01" }).success).toBe(true);
  });

  test("timestamp min/max (UTC-Instant) durchgesetzt", () => {
    const entity = createEntity({
      table: "T",
      fields: {
        at: createTimestampField({ min: "2026-01-01T00:00:00Z", max: "2026-12-31T23:59:59Z" }),
      },
    });
    const schema = buildInsertSchema(entity);
    expect(schema.safeParse({ at: "2026-06-15T10:00:00Z" }).success).toBe(true);
    expect(schema.safeParse({ at: "2027-01-01T00:00:00Z" }).success).toBe(false);
  });
});
