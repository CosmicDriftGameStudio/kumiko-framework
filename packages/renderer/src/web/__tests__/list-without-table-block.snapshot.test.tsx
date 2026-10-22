// Pins the markup of lists that do NOT declare a `table` block: the block's
// rollout must not change a single byte for them.

import { afterEach, describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { cleanup, render as plainRender, screen } from "@testing-library/react";
import type { Dispatcher, EditRelatedListSectionViewModel } from "../../headless/index.ts";
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
  RenderList,
  TokensProvider,
} from "../../index.ts";
import { defaultPrimitives } from "../primitives/index.tsx";
import { defaultTokens } from "../tokens.ts";
import { render } from "./test-utils.tsx";

afterEach(cleanup);

const taskEntity = {
  fields: {
    title: { type: "text", sortable: true },
    status: { type: "select", options: ["open", "done"] },
    priority: { type: "number", sortable: true },
  },
} as unknown as EntityDefinition;

const listScreen: EntityListScreenDefinition = {
  id: "tasks:screen:task-list",
  type: "entityList",
  entity: "task",
  columns: ["title", "status", "priority"],
};

const rows = [
  { id: "r1", title: "Alpha", status: "open", priority: 3 },
  { id: "r2", title: "Beta", status: "done", priority: 1 },
  { id: "r3", title: "Gamma", status: "open", priority: 2 },
];

function stableMarkup(): string {
  // React useId / Radix ids depend on mount order across tests and files.
  return document.body.innerHTML.replace(/:r[0-9a-z]+:/g, ":rX:").replace(/_r_[0-9a-z]+_/g, "_rX_");
}

function renderFullList(): void {
  render(
    <RenderList
      screen={listScreen}
      entity={taskEntity}
      rows={rows}
      featureName="tasks"
      searchable
      searchValue="al"
      onSearchChange={() => {}}
      sort={{ field: "title", dir: "asc" }}
      onSortChange={() => {}}
      pager={{ page: 2, limit: 3, total: 9, onPageChange: () => {} }}
      filterFacets={[
        {
          field: "status",
          label: "Status",
          options: [
            { value: "open", label: "Open" },
            { value: "done", label: "Done" },
          ],
        },
      ]}
      filterValues={{ status: ["open"] }}
      onFilterChange={() => {}}
      onFilterReset={() => {}}
    />,
  );
}

function withWidth(width: number, run: () => void): void {
  const happy = (window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } })
    .happyDOM;
  const original = window.innerWidth;
  happy.setInnerWidth(width);
  try {
    run();
  } finally {
    happy.setInnerWidth(original);
  }
}

const postEntity = {
  fields: {
    kanal: { type: "select", options: ["mobile.de", "instagram"] },
    status: { type: "select", options: ["geplant", "gepostet"] },
  },
} as unknown as EntityDefinition;

const features: readonly FeatureSchema[] = [
  { featureName: "campaigns", entities: { post: postEntity }, screens: [] },
];

const relatedRows = [
  { id: "p1", kanal: "mobile.de", status: "gepostet" },
  { id: "p2", kanal: "instagram", status: "geplant" },
];

const dispatcher = {
  query: async () => ({ isSuccess: true, data: { rows: relatedRows, nextCursor: null } }),
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

const section: EditRelatedListSectionViewModel = {
  kind: "relatedList",
  title: "Posts",
  query: "campaigns:query:post:list",
  entity: "post",
  columns: ["kanal", "status"],
  searchable: true,
  facets: [
    {
      field: "status",
      type: "select",
      label: "Status",
      options: [
        { value: "geplant", label: "Geplant" },
        { value: "gepostet", label: "Gepostet" },
      ],
    },
  ],
};

describe("lists without a table block", () => {
  test("table layout with facets, search, sort and pager", () => {
    withWidth(1024, () => {
      renderFullList();
      expect(stableMarkup()).toMatchSnapshot();
    });
  });

  test("card layout (narrow) with facets, search, sort and pager", () => {
    withWidth(500, () => {
      renderFullList();
      expect(stableMarkup()).toMatchSnapshot();
    });
  });

  test("relatedList section with facets", async () => {
    plainRender(
      <TokensProvider value={tokens}>
        <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en" })}>
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
    await screen.findByTestId("row-p1");
    expect(stableMarkup()).toMatchSnapshot();
  });
});
