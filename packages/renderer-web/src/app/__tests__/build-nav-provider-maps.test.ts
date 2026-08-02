import { describe, expect, mock, test } from "bun:test";
import type { TreeChildrenSubscribe } from "@cosmicdrift/kumiko-framework/engine";
import type { QualifiedContentCollection } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "../client-plugin";
import { buildNavProviderMaps } from "../create-app";

// Two ways a nav node gets its children: the app wires a navProvider by hand,
// or a feature derives one per r.contentCollection() from the schema. This
// pins how they compose — the derived one is the weaker claim.

const provider = (): TreeChildrenSubscribe => () => () => () => {};

function collection(id: string, kind: string): QualifiedContentCollection {
  return { id, kind, nav: { label: `mail:nav.${id}` }, navQn: `mail:nav:${id}` };
}

describe("buildNavProviderMaps", () => {
  test("qualifiziert lokale nav-ids, lässt fertige QNs durch", () => {
    const feature: ClientFeatureDefinition = {
      name: "cms",
      navProviders: { content: provider(), "app:nav:legal": provider() },
      navEntities: { content: ["text-block"] },
    };

    const { navProviders, navEntities } = buildNavProviderMaps([feature], []);
    expect([...navProviders.keys()].sort()).toEqual(["app:nav:legal", "cms:nav:content"]);
    expect(navEntities.get("cms:nav:content")).toEqual(["text-block"]);
  });

  test("Collections werden unter ihrer Schema-QN registriert, mit SSE-Entities", () => {
    const feature: ClientFeatureDefinition = {
      name: "template-resolver",
      navProvidersFromCollections: (collections) => ({
        providers: Object.fromEntries(collections.map((c) => [c.navQn, provider()])),
        entities: Object.fromEntries(collections.map((c) => [c.navQn, ["template-resource"]])),
      }),
    };

    const { navProviders, navEntities } = buildNavProviderMaps(
      [feature],
      [collection("templates", "mail-html"), collection("prompts", "ai-prompt")],
    );
    expect([...navProviders.keys()].sort()).toEqual(["mail:nav:prompts", "mail:nav:templates"]);
    expect(navEntities.get("mail:nav:prompts")).toEqual(["template-resource"]);
  });

  test("ein expliziter navProvider gewinnt gegen den abgeleiteten — ohne Konflikt-Warnung", () => {
    const explicitProvider = provider();
    const derivedFeature: ClientFeatureDefinition = {
      name: "template-resolver",
      navProvidersFromCollections: () => ({
        providers: { "mail:nav:templates": provider() },
      }),
    };
    const appFeature: ClientFeatureDefinition = {
      name: "app",
      navProviders: { "mail:nav:templates": explicitProvider },
    };

    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = mock((...args: unknown[]) => warnings.push(args));
    try {
      const { navProviders } = buildNavProviderMaps(
        [derivedFeature, appFeature],
        [collection("templates", "mail-html")],
      );
      expect(navProviders.get("mail:nav:templates")).toBe(explicitProvider);
      // Overriding a derived provider is the documented escape hatch, not a
      // conflict — warning here would train people to ignore the warning.
      expect(warnings).toHaveLength(0);
    } finally {
      console.warn = warn;
    }
  });

  test("zwei explizite Provider auf derselben QN warnen weiterhin", () => {
    const features: ClientFeatureDefinition[] = [
      { name: "a", navProviders: { "x:nav:content": provider() } },
      { name: "b", navProviders: { "x:nav:content": provider() } },
    ];

    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = mock((...args: unknown[]) => warnings.push(args));
    try {
      buildNavProviderMaps(features, []);
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = warn;
    }
  });

  test("Feature ohne Collections-Factory bleibt unberührt von deklarierten Collections", () => {
    const feature: ClientFeatureDefinition = { name: "cms", navProviders: { content: provider() } };
    const { navProviders } = buildNavProviderMaps(
      [feature],
      [collection("templates", "mail-html")],
    );
    expect([...navProviders.keys()]).toEqual(["cms:nav:content"]);
  });
});
