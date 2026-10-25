import { describe, expect, mock, test } from "bun:test";
import type { TreeChildrenSubscribe } from "@cosmicdrift/kumiko-framework/engine";
import type { QualifiedContentCollection } from "../../../index.ts";
import type { ClientFeatureDefinition } from "../client-plugin.tsx";
import { buildNavProviderMaps } from "../create-app.tsx";

// Two ways a nav node gets its children: the app wires a navProvider by hand,
// or a feature derives one per r.contentCollection() from the schema. This
// pins how they compose — the derived one is the weaker claim.

const provider = (): TreeChildrenSubscribe => () => () => () => {};

function collection(id: string, kind: string): QualifiedContentCollection {
  return { id, kind, nav: { label: `mail:nav.${id}` }, navQn: `mail:nav:${id}` };
}

describe("buildNavProviderMaps", () => {
  test("qualifies local nav-ids and passes through already-qualified QNs", () => {
    const feature: ClientFeatureDefinition = {
      name: "cms",
      navProviders: { content: provider(), "app:nav:legal": provider() },
      navEntities: { content: ["text-block"] },
    };

    const { navProviders, navEntities } = buildNavProviderMaps([feature], []);
    expect([...navProviders.keys()].sort()).toEqual(["app:nav:legal", "cms:nav:content"]);
    expect(navEntities.get("cms:nav:content")).toEqual(["text-block"]);
  });

  test("collections are registered under their schema QN, with SSE entities", () => {
    const feature: ClientFeatureDefinition = {
      name: "template-resolver",
      navProvidersFromCollections: (collections) => ({
        providers: Object.fromEntries(collections.map((c) => [c.navQn, provider()])),
        entities: Object.fromEntries(collections.map((c) => [c.navQn, ["template-resource"]])),
      }),
    };

    const { navProviders, navEntities } = buildNavProviderMaps(
      [feature],
      [collection("templates", "mail"), collection("prompts", "ai-prompt")],
    );
    expect([...navProviders.keys()].sort()).toEqual(["mail:nav:prompts", "mail:nav:templates"]);
    expect(navEntities.get("mail:nav:prompts")).toEqual(["template-resource"]);
  });

  test("an explicit navProvider wins over the derived one without a conflict warning", () => {
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
        [collection("templates", "mail")],
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

  test("a feature without a collections factory remains unaffected by declared collections", () => {
    const feature: ClientFeatureDefinition = { name: "cms", navProviders: { content: provider() } };
    const { navProviders } = buildNavProviderMaps([feature], [collection("templates", "mail")]);
    expect([...navProviders.keys()]).toEqual(["cms:nav:content"]);
  });
});
