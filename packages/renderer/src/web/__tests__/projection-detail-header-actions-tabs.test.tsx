// A header action with showOnTabs is rendered only while one of those tabs is active.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema, NavApi } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const tabsScreen: ProjectionDetailScreenDefinition = {
  id: "rent-detail",
  type: "projectionDetail",
  query: "rentals:query:rent:detail",
  idParam: "id",
  actions: [
    {
      id: "archive",
      label: "Archive rental",
      handler: "rentals:write:archive",
      showOnTabs: ["history"],
    },
  ],
  layout: {
    mode: "tabs",
    sections: [
      { id: "overview", title: "Overview", fields: ["description"] },
      { id: "history", title: "History", fields: ["notes"] },
    ],
  },
};

const schema: FeatureSchema = { featureName: "rentals", entities: {}, screens: [tabsScreen] };

function renderTab(tab: string): void {
  const query = (async () => ({
    isSuccess: true,
    data: { description: "Loft 4B", notes: "n" },
  })) as unknown as Dispatcher["query"];
  const navApi: NavApi = {
    route: undefined,
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: { tab },
    setSearchParams: () => {},
  };
  render(
    <NavProvider value={navApi}>
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen schema={schema} qn="rentals:screen:rent-detail" entityId="rent-1" />
      </DispatcherProvider>
    </NavProvider>,
  );
}

describe("projectionDetail header action showOnTabs", () => {
  test("action is shown on a listed tab", async () => {
    renderTab("history");
    expect(await screen.findByText("Archive rental")).toBeDefined();
  });

  test("action is hidden on another tab", async () => {
    renderTab("overview");
    await waitFor(() => screen.getByText("Loft 4B"));
    expect(screen.queryByText("Archive rental")).toBeNull();
  });
});
