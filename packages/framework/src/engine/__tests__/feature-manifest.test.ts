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

  test("featureNames filter — nur genannte Features im Manifest", () => {
    const registry = createRegistry([
      defineFeature("alpha", () => {}),
      defineFeature("beta", () => {}),
      defineFeature("gamma", () => {}),
    ]);

    const manifest = buildManifestFromRegistry(registry, {
      source: "test",
      featureNames: new Set(["alpha", "gamma"]),
    });

    expect(manifest.features.map((f) => f.name)).toEqual(["alpha", "gamma"]);
    expect(manifest.featureCount).toBe(2);
  });

  test("tier-Tagging — per-Feature + top-level im Manifest", () => {
    const registry = createRegistry([
      defineFeature("pro", () => {}),
      defineFeature("free", () => {}),
    ]);

    const manifest = buildManifestFromRegistry(registry, {
      source: "test",
      tier: "enterprise",
    });

    expect(manifest.tier).toBe("enterprise");
    for (const feature of manifest.features) {
      expect(feature.tier).toBe("enterprise");
    }
  });

  test("tier: undefined — weder per-Feature noch top-level vorhanden", () => {
    const registry = createRegistry([defineFeature("basic", () => {})]);

    const manifest = buildManifestFromRegistry(registry, { source: "test" });

    expect(manifest.tier).toBeUndefined();
    expect(manifest.features[0]?.tier).toBeUndefined();
  });

  test("uiHints flow through to the manifest when set", () => {
    const registry = createRegistry([
      defineFeature("with-hints", (r) => {
        r.uiHints({ displayLabel: "With Hints", category: "demo", recommended: true });
      }),
      defineFeature("no-hints", () => {}),
    ]);

    const manifest = buildManifestFromRegistry(registry, { source: "test" });
    const withHints = manifest.features.find((f) => f.name === "with-hints");
    const noHints = manifest.features.find((f) => f.name === "no-hints");

    expect(withHints?.uiHints).toEqual({
      displayLabel: "With Hints",
      category: "demo",
      recommended: true,
    });
    expect(noHints && "uiHints" in noHints).toBe(false);
  });
});
