import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { ENTITY_METAS, FEATURES } from "../../kumiko/schema";

describe("kumiko/schema.ts aligns with run-config boot", () => {
  test("ENTITY_METAS includes tasks + auth-mode tables", () => {
    const tables = new Set(ENTITY_METAS.map((m) => m.tableName));
    expect(tables.has("read_ui_walkthrough_tasks")).toBe(true);
    expect(tables.has("read_users")).toBe(true);
  });

  test("FEATURES pass validateBoot", () => {
    expect(() => validateBoot(FEATURES)).not.toThrow();
  });
});
