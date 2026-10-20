import { describe, expect, test } from "bun:test";
import {
  FILE_STORAGE_PROVIDER_ENV,
  validateBoot as validateBootRaw,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { ENTITY_METAS, FEATURES } from "../../kumiko/schema";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  // The sample server passes an in-memory provider at runtime; the guard only checks the env name.
  validateBootRaw(withBootValidatorFixture(features), {
    env: { [FILE_STORAGE_PROVIDER_ENV]: "inmemory" },
  });
}

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
