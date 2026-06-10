// Unit-tests for the pure helpers behind the kumiko-schema-check bin.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { implicitAuthModeFeatureNames, resolveGeneratePath } from "../schema-check-core";

describe("resolveGeneratePath", () => {
  test("defaults to drizzle/generate.ts when neither candidate exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "schema-check-"));
    try {
      expect(resolveGeneratePath(cwd)).toBe(join(cwd, "drizzle/generate.ts"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("falls back to schema/generate.ts when drizzle/ is absent but schema/ exists", () => {
    const cwd = mkdtempSync(join(tmpdir(), "schema-check-"));
    try {
      mkdirSync(join(cwd, "schema"), { recursive: true });
      writeFileSync(join(cwd, "schema/generate.ts"), "// stub", "utf-8");
      expect(resolveGeneratePath(cwd)).toBe(join(cwd, "schema/generate.ts"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("prefers drizzle/generate.ts when both exist", () => {
    const cwd = mkdtempSync(join(tmpdir(), "schema-check-"));
    try {
      mkdirSync(join(cwd, "drizzle"), { recursive: true });
      mkdirSync(join(cwd, "schema"), { recursive: true });
      writeFileSync(join(cwd, "drizzle/generate.ts"), "// stub", "utf-8");
      writeFileSync(join(cwd, "schema/generate.ts"), "// stub", "utf-8");
      expect(resolveGeneratePath(cwd)).toBe(join(cwd, "drizzle/generate.ts"));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("implicitAuthModeFeatureNames", () => {
  test("liefert exakt das bundled-foundation-Set", () => {
    // Bewusst hartkodierte Erwartung: ein Vergleich gegen composeFeatures
    // wäre tautologisch (die Funktion IST dieser Ausdruck). Ändert sich das
    // Foundation-Set, muss dieser Test bewusst angefasst werden.
    expect([...implicitAuthModeFeatureNames()].sort()).toEqual([
      "auth-email-password",
      "config",
      "tenant",
      "user",
    ]);
  });
});
