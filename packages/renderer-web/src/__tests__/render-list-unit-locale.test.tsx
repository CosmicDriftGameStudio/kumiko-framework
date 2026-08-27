// fw#2437: DataTableCell must thread the app locale (LocaleProvider) into
// `format: "unit"` / Intl.NumberFormat cells instead of falling back to the
// runtime's default locale — list vs. detail view could otherwise disagree
// ("72.5 m²" vs "72,5 m²") for the same value.
//
// DoD-Test: rendering the SAME `{ format: "unit", unit: "m2" }` column under
// two locales must produce two DIFFERENT cell labels — not just prove the
// unit-format key exists.

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

// Same all-text synthesized entity shape as projection-list-shim.ts /
// related-list-section.tsx — a projectionList/relatedList column has no real
// EntityDefinition, only a number-typed pseudo-field per column.
const areaColumnEntity = {
  fields: { area: { type: "number" } },
} as unknown as EntityDefinition;

const unitScreen: EntityListScreenDefinition = {
  id: "",
  type: "entityList",
  entity: "__projection__",
  columns: [{ field: "area", renderer: { format: "unit", unit: "m2" } }],
};

const numberScreen: EntityListScreenDefinition = {
  id: "",
  type: "entityList",
  entity: "__projection__",
  columns: [{ field: "area" }],
};

function renderAreaListUnderLocale(
  locale: string,
  areaValue: number,
  screen: EntityListScreenDefinition,
): string | null {
  cleanup();
  function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
    return (
      <TokensProvider value={stubTokens}>
        <LocaleProvider resolver={createStaticLocaleResolver({ locale })}>
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
      screen={screen}
      entity={areaColumnEntity}
      rows={[{ id: "r1", area: areaValue }]}
      featureName="listing"
    />,
    { wrapper: Wrapper },
  );
  return result.getByTestId("cell-r1-area").textContent;
}

describe("RenderList — format:unit-FormatSpec threads the app locale (fw#2437)", () => {
  test("dieselbe m2-Spalte unter zwei Locales rendert zwei verschiedene Beschriftungen", () => {
    expect(renderAreaListUnderLocale("de-DE", 72.5, unitScreen)).toBe("72,5 m²");
    expect(renderAreaListUnderLocale("en-US", 72.5, unitScreen)).toBe("72.5 m²");
  });

  test("ein renderer.locale gewinnt weiterhin vor dem App-Locale", () => {
    const screen: EntityListScreenDefinition = {
      id: "",
      type: "entityList",
      entity: "__projection__",
      columns: [{ field: "area", renderer: { format: "unit", unit: "m2", locale: "en-US" } }],
    };
    expect(renderAreaListUnderLocale("de-DE", 72.5, screen)).toBe("72.5 m²");
  });
});

describe("RenderList — default number-column threads the app locale (fw#2437)", () => {
  test("kein expliziter renderer: number-Zelle folgt dem App-Locale, nicht der Runtime-Locale", () => {
    expect(renderAreaListUnderLocale("de-DE", 1234.5, numberScreen)).toBe(
      new Intl.NumberFormat("de-DE").format(1234.5),
    );
    expect(renderAreaListUnderLocale("en-US", 1234.5, numberScreen)).toBe(
      new Intl.NumberFormat("en-US").format(1234.5),
    );
  });
});
