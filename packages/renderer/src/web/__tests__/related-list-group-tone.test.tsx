import { afterEach, describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { cleanup, render, screen } from "@testing-library/react";
import type { EditRelatedListSectionViewModel } from "../../headless/index.ts";
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
} from "../../index.ts";
import { defaultPrimitives } from "../primitives/index.tsx";
import { defaultTokens } from "../tokens.ts";
import { createMockDispatcher } from "./test-utils.tsx";

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

const bundles = { de: {} };

const rows = [
  { id: "p1", datum: "2026-09-29", status: "gepostet", kanal: "mobile.de" },
  { id: "p2", datum: "2026-10-01", status: "gepostet", kanal: "instagram" },
  { id: "p3", datum: "2026-10-05", status: "geplant", kanal: "instagram" },
];

const dispatcher = createMockDispatcher({
  query: async () => ({ isSuccess: true, data: { rows, nextCursor: null } }),
  write: async () => ({ isSuccess: true, data: null }),
  batch: async () => ({ isSuccess: true, results: [] }),
});

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

function renderSection(
  section: EditRelatedListSectionViewModel,
  record: Readonly<Record<string, unknown>> = { id: "c1" },
): void {
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
                    record={record}
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

describe("RelatedListSection rowTone", () => {
  test("rowTone tints only the rows matching its condition", async () => {
    renderSection({
      ...baseSection,
      entity: "post",
      rowTone: { field: "status", eq: "geplant", tone: "bad" },
    });

    expect((await screen.findByTestId("row-p3")).getAttribute("data-tone")).toBe("bad");
    expect(screen.getByTestId("row-p1").getAttribute("data-tone")).toBeNull();
  });

  test("a rule with fill adds the tone background to its rows only; a rule without fill keeps the stripe alone", async () => {
    renderSection({
      ...baseSection,
      entity: "post",
      rowTone: [
        { field: "status", eq: "geplant", tone: "bad", fill: true },
        { field: "status", eq: "gepostet", tone: "ok" },
      ],
    });

    const filled = await screen.findByTestId("row-p3");
    expect(filled.className).toContain("color-status-bad");
    expect(filled.className).toContain("color-mix");
    expect(screen.getByTestId("row-p1").className).not.toContain("color-mix");
    expect(screen.getByTestId("row-p1").getAttribute("data-tone")).toBe("ok");
  });

  test("an rowTone rule list tints with the first matching rule", async () => {
    renderSection({
      ...baseSection,
      entity: "post",
      rowTone: [
        { field: "kanal", eq: "instagram", tone: "warn" },
        { field: "status", eq: "geplant", tone: "bad" },
        { field: "status", eq: "gepostet", tone: "ok" },
      ],
    });

    expect((await screen.findByTestId("row-p1")).getAttribute("data-tone")).toBe("ok");
    expect(screen.getByTestId("row-p2").getAttribute("data-tone")).toBe("warn");
    expect(screen.getByTestId("row-p3").getAttribute("data-tone")).toBe("warn");
  });
});

describe("RelatedListSection rowActionsWhen", () => {
  const withRowActions: EditRelatedListSectionViewModel = {
    ...baseSection,
    entity: "post",
    rowActions: [
      { id: "mark", label: "Mark", handler: "campaigns:write:post:mark", display: "button" },
    ],
    rowActionsWhen: { field: "phase", eq: "open" },
  };

  test("draws the row-action column while the parent record matches", async () => {
    renderSection(withRowActions, { id: "c1", phase: "open" });

    await screen.findByTestId("row-p1-action-mark");
    expect(screen.queryByTestId("column-actions")).not.toBeNull();
  });

  test("draws no row-action column while the parent record does not match", async () => {
    renderSection(withRowActions, { id: "c1", phase: "closed" });

    await screen.findByTestId("row-p1");
    expect(screen.queryByTestId("row-p1-action-mark")).toBeNull();
    expect(screen.queryByTestId("column-actions")).toBeNull();
  });
});
