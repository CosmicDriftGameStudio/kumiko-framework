// fw#2376: the Members facet labels are i18n keys that the renderer resolves
// through translate() (fw#2373). A key missing from a locale pack resolves to
// nothing and the raw key ("tenant.members.filter.status") ends up in the UI —
// which is exactly what shipping translate() without the es/de entries did.
// The keys are read off the live screen definition instead of being hardcoded,
// so adding a facet option without translating it fails here rather than in
// production.
import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { localeEsBundle } from "@cosmicdrift/kumiko-locale-es";
import { MEMBERS_SCREEN_ID } from "../constants";
import { createTenantFeature } from "../feature";

function membersFacetLabelKeys(): readonly string[] {
  const screen = createTenantFeature().screens[MEMBERS_SCREEN_ID];
  if (screen?.type !== "projectionList") {
    throw new Error("expected members screen to be projectionList");
  }
  return (screen.facets ?? []).flatMap((facet) =>
    facet.type === "select"
      ? [facet.label, ...facet.options.map((option) => option.label)]
      : [facet.label, facet.trueLabel, facet.falseLabel],
  );
}

// Column labels of the members screen itself — deliberately scoped to this
// one screen, not a generic "walk every column of every screen" helper.
function membersColumnLabelKeys(): readonly string[] {
  const screen = createTenantFeature().screens[MEMBERS_SCREEN_ID];
  if (screen?.type !== "projectionList") {
    throw new Error("expected members screen to be projectionList");
  }
  return screen.columns.flatMap((col) =>
    typeof col === "string" || col.label === undefined ? [] : [col.label],
  );
}

// Nav-menu-entry label(s) that point at the members screen — same
// single-screen scope as the facet/column helpers above.
function membersNavLabelKeys(): readonly string[] {
  const feature = createTenantFeature();
  const membersScreenTarget = `${feature.name}:screen:${MEMBERS_SCREEN_ID}`;
  return Object.values(feature.navs)
    .filter((nav) => nav.screen === membersScreenTarget)
    .map((nav) => nav.label);
}

const facetKeys = membersFacetLabelKeys();
const membersScreenI18nKeys = [...facetKeys, ...membersColumnLabelKeys(), ...membersNavLabelKeys()];

const localePacks: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> = [
  ["es", localeEsBundle],
  ["de", localeDeBundle],
];

describe("members status filter labels are localized in every shipped locale (fw#2376)", () => {
  // A hardcoded toEqual() array here would fail with a confusing "array
  // mismatch" the moment a facet/column/nav-label key is added to the
  // members screen — instead of the clear "key not translated" failure a
  // missing en copy should produce. Reading the keys off the live screen
  // definition and checking each one resolves catches the real failure
  // mode (fw#2376) without hardcoding an ever-growing key list.
  test("every facet/column/nav-label key of the members screen has English copy", () => {
    expect(membersScreenI18nKeys.length).toBeGreaterThan(0);
    const translations = createTenantFeature().translations ?? {};
    for (const key of membersScreenI18nKeys) {
      const label = translations[key]?.["en"];
      expect(label).toBeString();
      expect(label).not.toBe(key);
      expect((label ?? "").trim()).not.toBe("");
    }
  });

  test("every facet label has English copy in the tenant feature itself", () => {
    const translations = createTenantFeature().translations ?? {};
    for (const key of facetKeys) {
      const label = translations[key]?.["en"];
      expect(label).toBeString();
      expect(label).not.toBe(key);
      expect((label ?? "").trim()).not.toBe("");
    }
  });

  for (const [locale, bundle] of localePacks) {
    test(`every facet label resolves to a localized string in ${locale}`, () => {
      for (const key of facetKeys) {
        const label = bundle[key];
        expect(label).toBeString();
        expect(label).not.toBe(key);
        expect((label ?? "").trim()).not.toBe("");
      }
    });
  }

  // Presence alone would still pass if a pack copied the English string in,
  // which is the failure mode a "did you actually translate it" check has to
  // catch for the two option labels users read in the dropdown.
  test("the option labels are real translations, not the English copy", () => {
    expect(localeEsBundle["tenant.members.filter.status.option.active"]).toBe("Activo");
    expect(localeEsBundle["tenant.members.filter.status.option.pending"]).toBe("Pendiente");
    expect(localeDeBundle["tenant.members.filter.status.option.active"]).toBe("Aktiv");
    expect(localeDeBundle["tenant.members.filter.status.option.pending"]).toBe("Ausstehend");
  });
});
