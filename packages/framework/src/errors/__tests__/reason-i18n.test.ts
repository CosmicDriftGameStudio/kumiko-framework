import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgentReasons, FrameworkReasons } from "../reasons";

type ReasonEntry = { readonly endUser?: string; readonly developer?: string };

const LOCALES = ["en", "de"] as const;
const ALL_REASONS: readonly string[] = [
  ...Object.values(FrameworkReasons),
  ...Object.values(AgentReasons),
];

function loadLocale(locale: (typeof LOCALES)[number]): Readonly<Record<string, ReasonEntry>> {
  const path = join(import.meta.dirname, "..", "i18n", `${locale}.yaml`);
  // Parse boundary: the YAML shape is the file's documented schema.
  return Bun.YAML.parse(readFileSync(path, "utf-8")) as Readonly<Record<string, ReasonEntry>>;
}

describe("reason i18n", () => {
  for (const locale of LOCALES) {
    test(`${locale}.yaml renders a docs page for every declared reason`, () => {
      const entries = loadLocale(locale);
      for (const reason of ALL_REASONS) {
        const entry = entries[reason];
        // The docgen skips a reason whose entry is missing or has neither
        // text — the page then stays absent from docs.kumiko.rocks.
        expect(entry, `${locale}.yaml has no entry for ${reason}`).toBeDefined();
        expect(entry?.endUser?.trim() ?? "").not.toBe("");
        expect(entry?.developer?.trim() ?? "").not.toBe("");
      }
    });
  }

  test("agent reasons are flat keys with the dot, not a nested agent map", () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(loadLocale(locale));
      expect(keys).toContain("agent.tool_not_allowed");
      expect(keys).not.toContain("agent");
    }
  });

  test("de and en cover the same reason keys", () => {
    expect(Object.keys(loadLocale("de")).sort()).toEqual(Object.keys(loadLocale("en")).sort());
  });
});
