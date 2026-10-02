// relatedList groupBy / rowTone: rows sit under collapsible group headers
// (label interpolates count/value/lastDate) and matching rows get a tone.

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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  de: { "campaigns.posts.group": "{count} Beiträge, zuletzt {lastDate} ({value})" },
};

const rows = [
  { id: "p1", datum: "2026-09-29", status: "gepostet", kanal: "mobile.de" },
  { id: "p2", datum: "2026-10-01", status: "gepostet", kanal: "instagram" },
  { id: "p3", datum: "2026-10-05", status: "geplant", kanal: "instagram" },
];

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

describe("RelatedListSection groupBy / rowTone", () => {
  const groupBy = {
    field: "status",
    collapsedWhen: "gepostet",
    label: "campaigns.posts.group",
    dateField: "datum",
  };

  test("groups get an interpolated header; the collapsedWhen group starts closed and toggles open", async () => {
    renderSection({ ...baseSection, entity: "post", groupBy });

    const posted = await screen.findByTestId("row-group-gepostet");
    expect(posted.textContent).toBe("2 Beiträge, zuletzt 01.10.2026 (gepostet)");
    expect(screen.getByTestId("row-group-geplant").textContent).toContain("1 Beiträge");
    expect(screen.queryByTestId("row-p1")).toBeNull();
    expect(screen.getByTestId("row-p3")).toBeTruthy();

    fireEvent.click(screen.getByTestId("row-group-gepostet-toggle"));
    expect(screen.getByTestId("row-p1")).toBeTruthy();
    expect(screen.getByTestId("row-p2")).toBeTruthy();
  });

  test("rowTone tints only the rows matching its condition", async () => {
    renderSection({
      ...baseSection,
      entity: "post",
      rowTone: { field: "status", eq: "geplant", tone: "bad" },
    });

    expect((await screen.findByTestId("row-p3")).getAttribute("data-tone")).toBe("bad");
    expect(screen.getByTestId("row-p1").getAttribute("data-tone")).toBeNull();
  });
});
