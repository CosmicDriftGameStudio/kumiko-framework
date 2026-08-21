// fw#2315: a list column with `renderer: { format: "enumOption", keyPrefix }`
// must resolve the raw enum value through useTranslation() in DataTableCell.
// Exercises the SAME synthesized-entity/pass-through-columns shape that
// ProjectionListBody (projection-list-shim.ts) and RelatedListSection
// (related-list-section.tsx) build for `projectionList`- and `relatedList`-
// screens — both delegate straight to RenderList with `columns` passed 1:1,
// so this proxies the real projectionList/relatedList render path without
// standing up a full query/dispatcher stack.
//
// DoD-Test: rendering the SAME column under two locales must produce two
// DIFFERENT cell labels — not just prove the format key exists.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  createStaticLocaleResolver,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  RenderList,
  TokensProvider,
  type TranslationsByLocale,
} from "@cosmicdrift/kumiko-renderer";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { defaultPrimitives } from "../primitives";
import { defaultTokens } from "../tokens";

const stubNav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};
const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "dark" as const,
  setMode: () => {},
  toggleMode: () => {},
};

// Same all-text synthesized entity shape as projection-list-shim.ts'
// synthesizeProjectionEntity / related-list-section.tsx's
// synthesizeRelatedListEntity — a projectionList/relatedList column has no
// real EntityDefinition, only a text-typed pseudo-field per column.
const statusColumnEntity = {
  fields: { status: { type: "text" } },
} as unknown as EntityDefinition;

const STATUS_KEY_PREFIX = "contact:entity:contact:field:status:option:";

const STATUS_BUNDLES: TranslationsByLocale = {
  de: { [`${STATUS_KEY_PREFIX}active`]: "Aktiv" },
  en: { [`${STATUS_KEY_PREFIX}active`]: "Active" },
};

const statusScreen: EntityListScreenDefinition = {
  id: "",
  type: "entityList",
  entity: "__projection__",
  columns: [{ field: "status", renderer: { format: "enumOption", keyPrefix: STATUS_KEY_PREFIX } }],
};

// Explicit cleanup() before each render — two renders happen inside a single
// test to prove the locale-switch, and RTL's auto-cleanup only fires between
// `test()` blocks, not within one.
function renderStatusListUnderLocale(locale: string, statusValue: string): string | null {
  cleanup();
  function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
    return (
      <TokensProvider value={stubTokens}>
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale })}
          fallbackBundles={[STATUS_BUNDLES]}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <NavProvider value={stubNav}>
              <LiveEventsProvider value={stubLiveEvents}>{children}</LiveEventsProvider>
            </NavProvider>
          </PrimitivesProvider>
        </LocaleProvider>
      </TokensProvider>
    );
  }
  const result = render(
    <RenderList
      screen={statusScreen}
      entity={statusColumnEntity}
      rows={[{ id: "r1", status: statusValue }]}
      featureName="contact"
    />,
    { wrapper: Wrapper },
  );
  return result.getByTestId("cell-r1-status").textContent;
}

describe("RenderList — enumOption-FormatSpec auf projectionList/relatedList-Spalten (fw#2315)", () => {
  test("dieselbe Spalte unter zwei Locales rendert zwei verschiedene Beschriftungen", () => {
    expect(renderStatusListUnderLocale("de", "active")).toBe("Aktiv");
    expect(renderStatusListUnderLocale("en", "active")).toBe("Active");
  });

  test("unbekannter Options-Key fällt auf den Rohwert zurück", () => {
    expect(renderStatusListUnderLocale("de", "archived")).toBe("archived");
  });
});
