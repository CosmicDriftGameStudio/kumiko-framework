import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { EMPTY_VALUE_PLACEHOLDER } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
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
import { defaultPrimitives } from "../primitives/index.tsx";
import { defaultTokens } from "../tokens.ts";
import { createMockDispatcher } from "./test-utils.tsx";

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
  fields: { name: { type: "text" }, owner: { type: "reference", entity: "owner" } },
} as unknown as EntityDefinition;

const screen: EntityListScreenDefinition = {
  id: "",
  type: "entityList",
  entity: "__projection__",
  columns: [{ field: "name" }, { field: "owner" }],
};

function renderRow(row: Record<string, unknown>): ReturnType<typeof render> {
  cleanup();
  function Wrapper({ children }: { readonly children: ReactNode }): ReactElement {
    return (
      <TokensProvider value={stubTokens}>
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "en" })}
          fallbackBundles={[kumikoDefaultTranslations]}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <NavProvider value={stubNav}>
              <DispatcherProvider dispatcher={createMockDispatcher()}>
                <LiveEventsProvider value={stubLiveEvents}>{children}</LiveEventsProvider>
              </DispatcherProvider>
            </NavProvider>
          </PrimitivesProvider>
        </LocaleProvider>
      </TokensProvider>
    );
  }
  return render(
    <RenderList
      screen={screen}
      entity={entity}
      rows={[{ id: "r1", ...row }]}
      featureName="sessions"
    />,
    { wrapper: Wrapper },
  );
}

describe("RenderList: empty values", () => {
  test("an empty plain cell and an empty reference cell show the same placeholder", () => {
    const view = renderRow({ name: null, owner: null });
    expect(view.getByTestId("cell-r1-name").textContent).toBe(EMPTY_VALUE_PLACEHOLDER);
    expect(view.getByTestId("cell-r1-owner").textContent).toBe(EMPTY_VALUE_PLACEHOLDER);
  });
});
