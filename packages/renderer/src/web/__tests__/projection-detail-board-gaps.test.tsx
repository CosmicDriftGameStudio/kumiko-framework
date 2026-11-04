// progress.placement "beside-steps" and the metric sub line.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { PageHeaderSlotAvailableProvider } from "../../page-header-slot.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const baseScreen: ProjectionDetailScreenDefinition = {
  id: "order-detail",
  type: "projectionDetail",
  query: "orders:query:order:detail",
  idParam: "id",
  steps: { field: "todo" },
  progress: { field: "chains", placement: "beside-steps" },
  metricsStyle: "tiles",
  metrics: [{ field: "total", label: "Total", subField: "totalNote" }],
  layout: { sections: [{ title: "Order", fields: ["total"] }] },
};

const record = {
  total: 120,
  totalNote: "2 payments",
  todo: [{ id: "s1", title: "Send reminder" }],
  chains: [
    {
      title: "Order",
      currentIndex: 1,
      steps: [
        { id: "placed", label: "Placed", done: true, detail: "21 Aug" },
        { id: "paid", label: "Paid", done: false },
      ],
    },
  ],
};

function renderDetail(
  detail: ProjectionDetailScreenDefinition,
  options: { readonly pageHeader?: boolean } = {},
): void {
  const query = (async () => ({ isSuccess: true, data: record })) as unknown as Dispatcher["query"];
  const body = (
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "orders", entities: {}, screens: [detail] }}
        qn="orders:screen:order-detail"
        entityId="o-1"
      />
    </DispatcherProvider>
  );
  render(
    options.pageHeader === true ? (
      <PageHeaderSlotAvailableProvider value={true}>{body}</PageHeaderSlotAvailableProvider>
    ) : (
      body
    ),
  );
}

describe("KumikoScreen / projectionDetail — board gaps", () => {
  test("beside-steps puts steps and a stacked stage list into one 8/4 grid", async () => {
    renderDetail(baseScreen);
    await waitFor(() => screen.getByTestId("record-progress-0"));
    const steps = screen.getByTestId("kumiko-screen-projection-detail-steps");
    const progress = screen.getByTestId("record-progress-0");
    expect(steps.closest(".lg\\:col-span-8")).not.toBeNull();
    expect(progress.closest(".lg\\:col-span-4")).not.toBeNull();
    expect(screen.getByTestId("record-progress-0-bar").tagName).toBe("OL");
    expect(progress.textContent).toContain("21 Aug");
    expect(screen.queryByTestId("record-progress-0-up-next")).toBeNull();
  });

  test("without the placement the chain keeps its own row and the up-next line", async () => {
    renderDetail({ ...baseScreen, progress: { field: "chains" } });
    await waitFor(() => screen.getByTestId("record-progress-0"));
    expect(screen.getByTestId("record-progress-0").closest(".lg\\:col-span-4")).toBeNull();
    expect(screen.getByTestId("record-progress-0-up-next")).toBeTruthy();
  });

  test("a chain without steps renders no progress and the steps take the full width", async () => {
    const emptyChain = { ...record, chains: [{ title: "Order", currentIndex: 0, steps: [] }] };
    const query = (async () => ({
      isSuccess: true,
      data: emptyChain,
    })) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen
          schema={{ featureName: "orders", entities: {}, screens: [baseScreen] }}
          qn="orders:screen:order-detail"
          entityId="o-1"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-steps"));
    expect(screen.queryByTestId("record-progress-0")).toBeNull();
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-steps").closest(".lg\\:col-span-12"),
    ).not.toBeNull();
  });

  test("the banner sits in the same px-6 inset as the other guidance blocks", async () => {
    const withBanner = { ...record, notice: { title: "Heads up", text: "Check this" } };
    const query = (async () => ({
      isSuccess: true,
      data: withBanner,
    })) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen
          schema={{
            featureName: "orders",
            entities: {},
            screens: [{ ...baseScreen, banner: { field: "notice" } }],
          }}
          qn="orders:screen:order-detail"
          entityId="o-1"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-banner"));
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-banner").closest(".px-6"),
    ).not.toBeNull();
  });

  test("a metric subField renders its value under the metric", async () => {
    renderDetail(baseScreen);
    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-metric-total"));
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-metric-total").textContent,
    ).toContain("2 payments");
  });

  describe.each([
    ["page header", true],
    ["head card", false],
  ])("metricsPlacement narrow after-guidance with the %s", (_name, pageHeader) => {
    const placed: ProjectionDetailScreenDefinition = {
      ...baseScreen,
      metricsPlacement: { narrow: "after-guidance" },
      layout: {
        mode: "tabs",
        sections: [
          { id: "a", title: "A", fields: ["total"] },
          { id: "b", title: "B", fields: ["total"] },
        ],
      },
    };

    test("metrics and tabs are ordered after the guidance blocks below md", async () => {
      renderDetail(placed, { pageHeader });
      await waitFor(() => screen.getByTestId("record-progress-0"));
      const metrics = screen.getByTestId("kumiko-screen-projection-detail-metrics");
      const wrapper = metrics.closest(".max-md\\:order-1");
      expect(wrapper).not.toBeNull();
      expect(wrapper?.parentElement?.className).toContain("flex-col");
      const steps = screen.getByTestId("kumiko-screen-projection-detail-steps");
      expect(wrapper?.contains(steps)).toBe(false);
      expect(steps.closest("[class*='max-md:order-']")).toBeNull();
      const tabs = screen.getByTestId("kumiko-screen-projection-detail-tabs");
      expect(tabs.closest(".max-md\\:order-2")).not.toBeNull();
    });

    test("without the placement nothing is reordered", async () => {
      renderDetail({ ...placed, metricsPlacement: undefined }, { pageHeader });
      await waitFor(() => screen.getByTestId("record-progress-0"));
      expect(document.querySelector("[class*='max-md:order-']")).toBeNull();
    });
  });
});
