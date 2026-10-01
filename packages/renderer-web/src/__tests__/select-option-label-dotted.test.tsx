// A select option value containing a dot ("mobile.de") renders its registered
// translation, or the raw value unchanged when none is registered. Only
// slug-shaped values ("degraded-performance") are humanized as a fallback.

import { afterEach, describe, expect, test } from "bun:test";
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
import { cleanup, render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../primitives/index.js";
import { defaultTokens } from "../tokens.js";

afterEach(cleanup);

const channelEntity = {
  fields: {
    kanal: { type: "select", options: ["mobile.de", "coches.net", "degraded-performance"] },
  },
} as unknown as EntityDefinition;

const listScreen: EntityListScreenDefinition = {
  id: "post-list",
  type: "entityList",
  entity: "post",
  columns: ["kanal"],
};

const bundles = {
  de: { "campaigns:entity:post:field:kanal:option:coches.net": "coches.net (Spanien)" },
};

const nav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: () => "",
  searchParams: {},
  setSearchParams: () => {},
};
const liveEvents: LiveEventSubscriber = () => () => {};
const tokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};

describe("select option labels with dotted values", () => {
  test("translated, untranslated and slug values in one list", () => {
    render(
      <TokensProvider value={tokens}>
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "de" })}
          fallbackBundles={[bundles]}
        >
          <PrimitivesProvider value={defaultPrimitives}>
            <NavProvider value={nav}>
              <LiveEventsProvider value={liveEvents}>
                <RenderList
                  screen={listScreen}
                  entity={channelEntity}
                  rows={[
                    { id: "r1", kanal: "mobile.de" },
                    { id: "r2", kanal: "coches.net" },
                    { id: "r3", kanal: "degraded-performance" },
                  ]}
                  featureName="campaigns"
                />
              </LiveEventsProvider>
            </NavProvider>
          </PrimitivesProvider>
        </LocaleProvider>
      </TokensProvider>,
    );
    expect(screen.getByTestId("cell-r1-kanal").textContent).toBe("mobile.de");
    expect(screen.getByTestId("cell-r2-kanal").textContent).toBe("coches.net (Spanien)");
    expect(screen.getByTestId("cell-r3-kanal").textContent).toBe("Degraded performance");
  });
});
