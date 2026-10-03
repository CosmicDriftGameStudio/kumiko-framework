import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  createStaticLocaleResolver,
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

// Projection lists synthesize every column as type "text", so the boolean
// format must not depend on the column type.
const currentColumnEntity = {
  fields: { current: { type: "text" } },
} as unknown as EntityDefinition;

const booleanScreen: EntityListScreenDefinition = {
  id: "",
  type: "entityList",
  entity: "__projection__",
  columns: [{ field: "current", renderer: { format: "boolean" } }],
};

function renderCurrentCell(current: boolean | null): HTMLElement {
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
              <LiveEventsProvider value={stubLiveEvents}>{children}</LiveEventsProvider>
            </NavProvider>
          </PrimitivesProvider>
        </LocaleProvider>
      </TokensProvider>
    );
  }
  const result = render(
    <RenderList
      screen={booleanScreen}
      entity={currentColumnEntity}
      rows={[{ id: "r1", current }]}
      featureName="sessions"
    />,
    { wrapper: Wrapper },
  );
  return result.getByTestId("cell-r1-current");
}

describe("RenderList: format boolean", () => {
  test("true renders a check mark with the accessible name Yes", () => {
    const cell = renderCurrentCell(true);
    expect(cell.textContent).toContain("Yes");
    expect(cell.textContent).not.toContain("true");
  });

  test("false renders the accessible name No, never the raw string", () => {
    const cell = renderCurrentCell(false);
    expect(cell.textContent).toContain("No");
    expect(cell.textContent).not.toContain("false");
  });

  test("null renders empty instead of No", () => {
    const cell = renderCurrentCell(null);
    expect(cell.textContent).not.toContain("No");
    expect(cell.textContent).not.toContain("Yes");
  });
});
