import { describe, expect, test } from "bun:test";
import { ConfigScopes } from "../constants";
import { buildManifestFromRegistry, createRegistry, defineFeature } from "../index";

const boolKey = {
  type: "boolean",
  scope: ConfigScopes.system,
  access: { read: ["anonymous"], write: ["anonymous"] },
} as const;

describe("buildManifestFromRegistry — deterministic codepoint sort (#330)", () => {
  // `bZeta` vs `balpha`: localeCompare orders these case-insensitively
  // (balpha < bZeta), but a codepoint sort puts uppercase 'Z' (U+005A) ahead of
  // lowercase 'a' (U+0061) — the two comparators DISAGREE. The manifest is
  // serialized to byte-exact JSON and must not depend on the runner's ICU
  // locale (macOS-dev vs Linux-CI). This assertion fails the instant anyone
  // reverts buildManifestFromRegistry to localeCompare. (Feature names skip the
  // kebab normalization that config/secret short-names go through, so they are
  // the one place a case-based disagreement survives into the sorted output.)
  test("features are ordered by codepoint name, not locale", () => {
    const registry = createRegistry([
      defineFeature("bZeta", () => {}),
      defineFeature("balpha", () => {}),
    ]);

    const manifest = buildManifestFromRegistry(registry, { source: "test" });

    expect(manifest.features.map((f) => f.name)).toEqual(["bZeta", "balpha"]);
  });

  test("config keys within a feature come out sorted by qualified name", () => {
    const feature = defineFeature("demo", (r) => {
      r.config({ keys: { "z-flag": boolKey, "a-flag": boolKey } });
    });
    const registry = createRegistry([feature]);

    const manifest = buildManifestFromRegistry(registry, { source: "test" });
    const demo = manifest.features.find((f) => f.name === "demo");

    expect(demo?.configKeys.map((k) => k.qualifiedName)).toEqual([
      "demo:config:a-flag",
      "demo:config:z-flag",
    ]);
  });
});
