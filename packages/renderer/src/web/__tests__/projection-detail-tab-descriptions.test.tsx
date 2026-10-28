// An explanatory sentence per tab: every kind of section in a projectionDetail with
// layout.mode "tabs" shows its `description` under the tab strip.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema, NavApi } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const DETAIL_QUERY = "rentals:query:rent:detail";
const PAYMENTS_QUERY = "rentals:query:rent:payments";

const detailRow = { description: "Loft 4B", address: "12 Canal St" };

const tabsScreen: ProjectionDetailScreenDefinition = {
  id: "rent-detail",
  type: "projectionDetail",
  query: DETAIL_QUERY,
  idParam: "id",
  layout: {
    mode: "tabs",
    sections: [
      {
        id: "overview",
        title: "Overview",
        description: "Master data of the rental.",
        fields: ["description"],
      },
      {
        id: "location",
        title: "Location",
        description: "Where the rental is located.",
        groups: [{ title: "Address", fields: ["address"] }],
      },
      {
        id: "payments",
        kind: "relatedList",
        title: "Payments",
        description: "Everything the tenant paid so far.",
        query: PAYMENTS_QUERY,
        columns: [{ field: "amount", label: "Amount" }],
      },
    ],
  },
};

const schema: FeatureSchema = { featureName: "rentals", entities: {}, screens: [tabsScreen] };

function dispatcherWithPayments(paymentRows: readonly Record<string, unknown>[]): Dispatcher {
  const query = (async (type: string) => {
    if (type === DETAIL_QUERY) return { isSuccess: true, data: detailRow };
    return { isSuccess: true, data: { rows: paymentRows, nextCursor: null } };
  }) as unknown as Dispatcher["query"];
  return createMockDispatcher({ query });
}

function renderTab(tab: string, dispatcher: Dispatcher): void {
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
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="rentals:screen:rent-detail" entityId="rent-1" />
      </DispatcherProvider>
    </NavProvider>,
  );
}

describe("projectionDetail tabs: description per tab", () => {
  test("a fields tab shows its description", async () => {
    renderTab("overview", dispatcherWithPayments([]));
    expect(await screen.findByText("Master data of the rental.")).toBeTruthy();
  });

  test("a groups tab shows its description", async () => {
    renderTab("location", dispatcherWithPayments([]));
    await waitFor(() => screen.getByText("Where the rental is located."));
    expect(screen.getByText("Address")).toBeTruthy();
  });

  test("a relatedList tab with rows shows its description", async () => {
    renderTab("payments", dispatcherWithPayments([{ id: "p1", amount: 480 }]));
    await waitFor(() => screen.getByText("Everything the tenant paid so far."));
    expect(screen.getByText("480")).toBeTruthy();
  });

  test("an empty relatedList tab still shows its description", async () => {
    renderTab("payments", dispatcherWithPayments([]));
    expect(await screen.findByText("Everything the tenant paid so far.")).toBeTruthy();
  });
});
