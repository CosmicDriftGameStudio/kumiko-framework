// A multiSelect list column renders one pill per picked value, like a select
// column renders one pill — not a single pill holding the joined text.

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
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { defaultPrimitives } from "../primitives/index.js";
import { defaultTokens } from "../tokens.js";

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

const entity = {
  fields: {
    role: { type: "select", options: ["admin", "viewer"] },
    labels: { type: "multiSelect", options: ["hot-lead", "vip"] },
  },
} as unknown as EntityDefinition;

const screen: EntityListScreenDefinition = {
  id: "",
  type: "entityList",
  entity: "contact",
  columns: [{ field: "role" }, { field: "labels" }],
};

function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <TokensProvider value={stubTokens}>
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
        <PrimitivesProvider value={defaultPrimitives}>
          <NavProvider value={stubNav}>
            <LiveEventsProvider value={stubLiveEvents}>{children}</LiveEventsProvider>
          </NavProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
}

describe("RenderList — multiSelect column pills", () => {
  test("each picked value gets its own pill, matching the select column", () => {
    const result = render(
      <RenderList
        screen={screen}
        entity={entity}
        rows={[{ id: "r1", role: "admin", labels: ["hot-lead", "vip"] }]}
        featureName="contact"
      />,
      { wrapper: Wrapper },
    );
    const selectCell = result.getByTestId("cell-r1-role");
    const multiCell = result.getByTestId("cell-r1-labels");
    const pillSelector = "[data-slot='badge']";
    expect(selectCell.querySelectorAll(pillSelector).length).toBe(1);
    const pills = Array.from(multiCell.querySelectorAll(pillSelector));
    expect(pills.map((pill) => pill.textContent)).toEqual(["Hot lead", "Vip"]);
  });
});
