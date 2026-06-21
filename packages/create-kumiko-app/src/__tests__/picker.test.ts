import { describe, expect, test } from "bun:test";
import { FEATURE_CONSTRUCTORS } from "../feature-constructors";
import { loadManifest } from "../manifest";
import { buildChoices } from "../picker";

describe("buildChoices", () => {
  const manifest = loadManifest();
  const choices = buildChoices(manifest);

  test("only emits features that have a constructor entry", () => {
    for (const c of choices) {
      expect(Object.hasOwn(FEATURE_CONSTRUCTORS, c.name)).toBe(true);
    }
  });

  test("every MVP feature is represented (no silent drops)", () => {
    const choiceNames = new Set(choices.map((c) => c.name));
    for (const name of Object.keys(FEATURE_CONSTRUCTORS)) {
      expect(choiceNames.has(name)).toBe(true);
    }
  });

  test("recommended features land checked by default", () => {
    const recommended = choices.filter((c) => c.recommended);
    expect(recommended.length).toBeGreaterThan(0);
    expect(recommended.map((c) => c.name)).toContain("auth-email-password");
  });

  test("category falls back to 'other' when uiHints absent", () => {
    for (const c of choices) {
      expect(typeof c.category).toBe("string");
      expect(c.category.length).toBeGreaterThan(0);
    }
  });
});
