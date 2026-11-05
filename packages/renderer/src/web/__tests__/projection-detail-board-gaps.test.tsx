// progress.placement "beside-steps" and the metric sub line.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { PageHeaderSlotAvailableProvider } from "../../page-header-slot.ts";
import {
  createMockDispatcher,
  render,
  renderWithPrimitivesOverride,
  screen,
  waitFor,
} from "./test-utils.tsx";

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
  totalLabel: "Rent from 01.12.",
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

  test("a metric labelField replaces the static label", async () => {
    const labelled = {
      ...baseScreen,
      metrics: [{ field: "total", label: "Total", labelField: "totalLabel" }],
    };
    renderDetail(labelled);
    await waitFor(() => screen.getByTestId("kumiko-screen-projection-detail-metric-total"));
    expect(
      screen.getByTestId("kumiko-screen-projection-detail-metric-total").textContent,
    ).toContain("Rent from 01.12.");
  });

  test("hideIcon keeps the icon out of a banner action button, without it the icon is drawn", async () => {
    const action = {
      id: "refresh-order",
      label: "Refresh order",
      handler: "orders:write:order:refresh",
    } as const;
    const withBanner = (hideIcon: boolean): ProjectionDetailScreenDefinition => ({
      ...baseScreen,
      banner: { field: "notice", actions: [hideIcon ? { ...action, hideIcon: true } : action] },
    });
    const notice = { ...record, notice: { title: "Heads up" } };
    const query = (async () => ({
      isSuccess: true,
      data: notice,
    })) as unknown as Dispatcher["query"];
    for (const hideIcon of [true, false]) {
      const { unmount } = render(
        <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
          <KumikoScreen
            schema={{ featureName: "orders", entities: {}, screens: [withBanner(hideIcon)] }}
            qn="orders:screen:order-detail"
            entityId="o-1"
          />
        </DispatcherProvider>,
      );
      await waitFor(() => screen.getByText("Refresh order"));
      const button = screen.getByText("Refresh order").closest("button");
      expect(button?.querySelector("svg") === null).toBe(hideIcon);
      unmount();
    }
  });

  test("hideIcon holds for both label variants of a step action and the reason (i) hides below sm", async () => {
    const stepScreen: ProjectionDetailScreenDefinition = {
      ...baseScreen,
      steps: {
        field: "todo",
        actions: [
          {
            id: "send-reminder",
            label: "Send reminder",
            narrowLabel: "Send",
            handler: "orders:write:order:remind",
            hideIcon: true,
          },
        ],
      },
    };
    const query = (async () => ({
      isSuccess: true,
      data: { ...record, todo: [{ id: "s1", title: "Remind", why: "Because" }] },
    })) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen
          schema={{ featureName: "orders", entities: {}, screens: [stepScreen] }}
          qn="orders:screen:order-detail"
          entityId="o-1"
        />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByText("Send reminder"));
    for (const label of ["Send reminder", "Send"]) {
      expect(screen.getByText(label).closest("button")?.querySelector("svg")).toBeNull();
    }
    expect(document.body.querySelector("span.flex.max-sm\\:hidden button")).not.toBeNull();
  });

  test("whyOpen opens the step reason as a box with a bold whyTitle lead-in", async () => {
    const stepScreen: ProjectionDetailScreenDefinition = {
      ...baseScreen,
      steps: { field: "todo" },
    };
    const query = (async () => ({
      isSuccess: true,
      data: {
        ...record,
        todo: [
          {
            id: "s1",
            title: "Remind",
            why: "Overdue 14 days.",
            whyOpen: true,
            whyTitle: "Rule 10",
          },
          { id: "s2", title: "Escalate", why: "Two mails unanswered." },
        ],
      },
    })) as unknown as Dispatcher["query"];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen
          schema={{ featureName: "orders", entities: {}, screens: [stepScreen] }}
          qn="orders:screen:order-detail"
          entityId="o-1"
        />
      </DispatcherProvider>,
    );
    const box = await screen.findByTestId("record-step-s1-reason");
    expect(box.textContent).toContain("Overdue 14 days.");
    expect(box.querySelector("b")?.textContent?.trim()).toBe("Rule 10");
    expect(screen.queryByTestId("record-step-s2-reason")).toBeNull();
  });

  describe("narrowLabel and narrowSubtitle", () => {
    const action = {
      id: "refresh-order",
      label: "Refresh order",
      narrowLabel: "Refresh",
      handler: "orders:write:order:refresh",
    } as const;
    const withBannerAction: ProjectionDetailScreenDefinition = {
      ...baseScreen,
      banner: { field: "notice", actions: [action] },
    };
    const notice = { ...record, notice: { title: "Heads up" } };

    function renderNotice(
      detail: ProjectionDetailScreenDefinition,
      data: Record<string, unknown>,
      primitives?: Parameters<typeof renderWithPrimitivesOverride>[1],
    ): void {
      const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
      const ui = (
        <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
          <KumikoScreen
            schema={{ featureName: "orders", entities: {}, screens: [detail] }}
            qn="orders:screen:order-detail"
            entityId="o-1"
          />
        </DispatcherProvider>
      );
      if (primitives === undefined) render(ui);
      else renderWithPrimitivesOverride(ui, primitives);
    }

    test("a narrowLabel draws both labels, one per breakpoint", async () => {
      renderNotice(withBannerAction, notice);
      await waitFor(() => screen.getByText("Refresh order"));
      expect(screen.getByText("Refresh")).toBeTruthy();
    });

    test("without FillContainer the host gets the one button, not both stacked", async () => {
      renderNotice(withBannerAction, notice, { FillContainer: undefined });
      await waitFor(() => screen.getByText("Refresh order"));
      expect(screen.queryByText("Refresh")).toBeNull();
    });

    const withSubtitle = (narrowSubtitle: string): ProjectionDetailScreenDefinition => ({
      ...baseScreen,
      header: { title: "total", subtitle: "totalNote", narrowSubtitle },
    });

    test("narrowSubtitle draws a second subtitle next to the full one", async () => {
      renderNotice(withSubtitle("shortNote"), { ...record, shortNote: "2 pay." });
      const narrow = await screen.findByTestId("kumiko-screen-projection-detail-narrow-subtitle");
      expect(narrow.textContent).toBe("2 pay.");
      expect(screen.getByTestId("kumiko-screen-projection-detail-subtitle").textContent).toBe(
        "2 payments",
      );
    });

    test("an empty narrow value leaves the full subtitle without a breakpoint wrapper", async () => {
      renderNotice(withSubtitle("shortNote"), { ...record, shortNote: "" });
      const full = await screen.findByTestId("kumiko-screen-projection-detail-subtitle");
      expect(screen.queryByTestId("kumiko-screen-projection-detail-narrow-subtitle")).toBeNull();
      expect(full.closest(".max-sm\\:hidden")).toBeNull();
    });
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
