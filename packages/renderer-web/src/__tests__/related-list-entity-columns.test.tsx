// relatedList columns backed by a declared `entity` render through the same
// cell formatter as entityList columns: a select value becomes a status badge
// with its translated option label, a date is locale-formatted. Without
// `entity` the same rows stay plain text.

import { afterEach, describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher, EditRelatedListSectionViewModel } from "@cosmicdrift/kumiko-headless";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DispatcherProvider,
  type FeatureSchema,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  RelatedListSection,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import { cleanup, render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../primitives/index.js";
import { defaultTokens } from "../tokens.js";

afterEach(cleanup);

const postEntity = {
  fields: {
    datum: { type: "date" },
    kanal: { type: "select", options: ["mobile.de", "instagram"] },
    status: {
      type: "select",
      options: ["geplant", "gepostet"],
      optionTones: { geplant: "neutral", gepostet: "ok" },
    },
  },
} as unknown as EntityDefinition;

const features: readonly FeatureSchema[] = [
  { featureName: "campaigns", entities: { post: postEntity }, screens: [] },
];

const bundles = {
  de: { "campaigns:entity:post:field:status:option:gepostet": "Veröffentlicht" },
};

const rows = [{ id: "p1", datum: "2026-09-29", status: "gepostet", kanal: "mobile.de" }];

const dispatcher = {
  query: async () => ({ isSuccess: true, data: { rows, nextCursor: null } }),
  write: async () => ({ isSuccess: true, data: null }),
  batch: async () => ({ isSuccess: true, results: [] }),
  statusStore: { getState: () => "online", subscribe: () => () => {} },
  async *stream() {},
  pendingWrites: () => [],
  pendingFiles: () => [],
} as unknown as Dispatcher;

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

const baseSection: EditRelatedListSectionViewModel = {
  kind: "relatedList",
  title: "Posts",
  query: "campaigns:query:post:list",
  columns: ["datum", "status", "kanal"],
};

function renderSection(section: EditRelatedListSectionViewModel): void {
  render(
    <TokensProvider value={tokens}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de" })}
        fallbackBundles={[bundles]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <NavProvider value={nav}>
            <LiveEventsProvider value={liveEvents}>
              <DispatcherProvider dispatcher={dispatcher}>
                <AppFeaturesProvider features={features}>
                  <RelatedListSection
                    section={section}
                    parentId="c1"
                    record={{ id: "c1" }}
                    featureName="campaigns"
                  />
                </AppFeaturesProvider>
              </DispatcherProvider>
            </LiveEventsProvider>
          </NavProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>,
  );
}

describe("RelatedListSection entity-backed columns", () => {
  test("a select column renders a status badge with the translated option label", async () => {
    renderSection({ ...baseSection, entity: "post" });
    const cell = await screen.findByTestId("cell-p1-status");
    expect(cell.textContent).toBe("Veröffentlicht");
    expect(cell.querySelector("[data-status-dot]")).not.toBeNull();
  });

  test("a date column renders locale-formatted instead of ISO", async () => {
    renderSection({ ...baseSection, entity: "post" });
    const cell = await screen.findByTestId("cell-p1-datum");
    expect(cell.textContent).toBe("29.09.2026");
  });

  test("an untranslated dotted option value stays as stored, not capitalized", async () => {
    renderSection({ ...baseSection, entity: "post" });
    expect((await screen.findByTestId("cell-p1-kanal")).textContent).toBe("mobile.de");
  });

  test("without entity the columns stay plain text", async () => {
    renderSection(baseSection);
    expect((await screen.findByTestId("cell-p1-status")).textContent).toBe("gepostet");
    expect(screen.getByTestId("cell-p1-status").querySelector("[data-status-dot]")).toBeNull();
    expect(screen.getByTestId("cell-p1-datum").textContent).toBe("2026-09-29");
  });
});
