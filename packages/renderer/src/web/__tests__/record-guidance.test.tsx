// Row tone / hint cell on projectionList and the breadcrumb, summary, banner and steps blocks on projectionDetail.
import { describe, expect, mock, test } from "bun:test";
import type {
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { DataTable } from "./_primitives-helpers.tsx";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils.tsx";

const listScreen: ProjectionListScreenDefinition = {
  id: "orders",
  type: "projectionList",
  query: "shop:query:order:list",
  rowToneField: "tone",
  columns: [{ field: "name" }, { field: "next", hint: { detailField: "due", reasonField: "why" } }],
};

function renderList(rows: readonly Record<string, unknown>[]): void {
  const query = (async () => ({
    isSuccess: true,
    data: { rows, nextCursor: null },
  })) as unknown as Dispatcher["query"];
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "shop", entities: {}, screens: [listScreen] }}
        qn="shop:screen:orders"
      />
    </DispatcherProvider>,
  );
}

describe("projectionList row guidance", () => {
  test("rowToneField tints the row, the hint cell shows sentence, detail and tone", async () => {
    renderList([
      { id: "o1", name: "Order 1", next: "Call customer", due: "today", why: "Late", tone: "bad" },
    ]);
    await waitFor(() => expect(screen.getByText("Order 1")).toBeTruthy());
    expect(screen.getByText("Order 1").closest("tr")?.className).toContain("bg-status-bad/10");
    const sentence = screen.getByText("Call customer");
    expect(sentence.parentElement?.getAttribute("data-hint-tone")).toBe("bad");
    expect(screen.getByText("today")).toBeTruthy();
  });

  test("an empty hint shows the translated empty label and the Why toggle opens the reason", async () => {
    renderList([
      { id: "o1", name: "Order 1", next: "", why: "x", tone: "ok" },
      { id: "o2", name: "Order 2", next: "Ship it", why: "Paid already", tone: "ok" },
    ]);
    await waitFor(() => expect(screen.getByText("Nothing open")).toBeTruthy());
    expect(screen.queryByText("Paid already")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText("Paid already")).toBeTruthy();
  });

  test("a hint in the row-open first cell shows the reason open instead of nesting a toggle", () => {
    const onRowClick = mock();
    render(
      <DataTable
        columns={[
          {
            field: "next",
            label: "Next",
            type: "text",
            sortable: false,
            hint: { emptyLabel: "Nothing open", reasonLabel: "Why?", reasonField: "why" },
          },
        ]}
        rows={[{ id: "r1", values: { next: "Ship it", why: "Paid already" } }]}
        testId="dt"
        onRowClick={onRowClick}
        rowActions={[{ id: "open", label: "Open", rowClick: true, onTrigger: mock() }]}
      />,
    );
    const sentence = screen.getByText("Ship it");
    expect(sentence.closest("button")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Why?" })).toBeNull();
    expect(screen.getByText("Paid already").closest("button")).toBe(sentence.closest("button"));
    fireEvent.click(sentence);
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
});

const archive = {
  kind: "writeHandler",
  id: "archive",
  label: "Archive it",
  handler: "shop:write:order:archive",
} as const;

const detailScreen: ProjectionDetailScreenDefinition = {
  id: "order-detail",
  type: "projectionDetail",
  query: "shop:query:order:detail",
  breadcrumb: { field: "path" },
  summary: { field: "line", toneField: "tone" },
  banner: { field: "notice", actions: [{ ...archive, icon: "archive" }] },
  progress: { field: "progress" },
  steps: {
    field: "steps",
    actions: [{ ...archive, id: "close", label: "Close it", icon: "archive" }],
  },
  layout: { sections: [{ title: "Order", fields: ["name"] }] },
};

function renderDetail(data: Record<string, unknown>, write?: Dispatcher["write"]): void {
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  render(
    <DispatcherProvider
      dispatcher={{ ...createMockDispatcher({ query }), ...(write !== undefined && { write }) }}
    >
      <KumikoScreen
        schema={{ featureName: "shop", entities: {}, screens: [detailScreen] }}
        qn="shop:screen:order-detail"
        entityId="o1"
      />
    </DispatcherProvider>,
  );
}

const FULL = {
  id: "o1",
  name: "Order 1",
  path: [{ label: "Orders" }, { label: "Order 1" }],
  line: "Waiting for payment",
  tone: "warn",
  notice: { title: "Overdue", text: "14 days late", tone: "bad" },
  steps: [
    { id: "s1", title: "Send reminder", detail: "by Friday", why: "No payment yet" },
    { id: "s2", title: "Escalate" },
  ],
};

describe("projectionDetail record guidance blocks", () => {
  test("renders breadcrumb, summary, banner and steps from the record", async () => {
    renderDetail(FULL);
    await waitFor(() => expect(screen.getByText("Waiting for payment")).toBeTruthy());
    expect(screen.getByTestId("kumiko-screen-projection-detail-breadcrumb").textContent).toContain(
      "Orders",
    );
    expect(screen.getByTestId("kumiko-screen-projection-detail-summary").textContent).toBe(
      "Waiting for payment",
    );
    const banner = screen.getByTestId("kumiko-screen-projection-detail-banner");
    expect(banner.textContent).toContain("Overdue");
    expect(banner.textContent).toContain("14 days late");
    expect(screen.getByText("Send reminder")).toBeTruthy();
    expect(screen.getByText("Escalate")).toBeTruthy();
  });

  test("the steps reason sits behind a toggle", async () => {
    renderDetail(FULL);
    await waitFor(() => expect(screen.getByText("Send reminder")).toBeTruthy());
    expect(screen.queryByText("No payment yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText("No payment yet")).toBeTruthy();
  });

  test("banner and steps actions dispatch their handler with the shown record id", async () => {
    const write = mock(async (_type: string, _payload: unknown) => ({ isSuccess: true, data: {} }));
    renderDetail(FULL, write as unknown as Dispatcher["write"]);
    await waitFor(() => expect(screen.getByText("Send reminder")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "Close it" })[0] as HTMLElement);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(write.mock.calls[0]?.[0]).toBe("shop:write:order:archive");
    expect(write.mock.calls[0]?.[1]).toEqual({ id: "o1" });
  });

  test("a notice tone outside SelectOptionTone falls back to the info banner", async () => {
    renderDetail({ ...FULL, notice: { title: "Overdue", tone: "loud" } });
    await waitFor(() =>
      expect(screen.getByTestId("kumiko-screen-projection-detail-banner")).toBeTruthy(),
    );
    const banner = screen.getByTestId("kumiko-screen-projection-detail-banner");
    expect(banner.getAttribute("data-variant")).toBe("info");
  });

  test("a step without a title is dropped", async () => {
    renderDetail({ ...FULL, steps: [{ id: "s0", title: "", tone: "bad" }, ...FULL.steps] });
    await waitFor(() => expect(screen.getByText("Send reminder")).toBeTruthy());
    const steps = screen.getByTestId("kumiko-screen-projection-detail-steps");
    expect(steps.querySelector("[data-tone='bad']")).toBeNull();
    expect(steps.textContent).toContain("Escalate");
  });

  test("null banner, empty summary and empty path drop their blocks; empty steps show the empty label", async () => {
    renderDetail({ ...FULL, notice: null, line: "", path: [], steps: [] });
    await waitFor(() => expect(screen.getByText("Order 1")).toBeTruthy());
    expect(screen.queryByTestId("kumiko-screen-projection-detail-banner")).toBeNull();
    expect(screen.queryByTestId("kumiko-screen-projection-detail-summary")).toBeNull();
    expect(screen.queryByTestId("kumiko-screen-projection-detail-breadcrumb")).toBeNull();
    expect(screen.getByTestId("kumiko-screen-projection-detail-steps")).toBeTruthy();
  });

  const CHAIN = {
    title: "Order to cash",
    currentIndex: 1,
    steps: [
      { id: "placed", label: "Placed", done: true },
      { id: "paid", label: "Paid", done: false, detail: "312 EUR open" },
    ],
  };

  test("progress chains render one step bar each with heading, done steps and the current step up next", async () => {
    renderDetail({ ...FULL, progress: [CHAIN, { ...CHAIN, title: "Fulfilment" }] });
    await waitFor(() => expect(screen.getByTestId("record-progress-0")).toBeTruthy());
    expect(screen.getByTestId("record-progress-1")).toBeTruthy();
    expect(screen.getByTestId("record-progress-0").textContent).toContain("Order to cash");
    const bar = screen.getByTestId("record-progress-0-bar");
    expect(bar.textContent).toContain("DonePlaced");
    expect(bar.querySelector("[aria-current='step']")?.textContent).toContain("Paid");
    const upNext = screen.getByTestId("record-progress-0-up-next");
    expect(upNext.textContent).toContain("Up next");
    expect(upNext.textContent).toContain("Paid");
    expect(upNext.textContent).toContain("312 EUR open");
    expect(screen.getByText("Fulfilment")).toBeTruthy();
  });

  test("an empty progress array drops the block", async () => {
    renderDetail({ ...FULL, progress: [] });
    await waitFor(() => expect(screen.getByText("Waiting for payment")).toBeTruthy());
    expect(screen.queryByTestId("record-progress-0")).toBeNull();
  });

  test("a progress value that is not a chain list drops the block", async () => {
    renderDetail({ ...FULL, progress: "not a list" });
    await waitFor(() => expect(screen.getByText("Waiting for payment")).toBeTruthy());
    expect(screen.queryByTestId("record-progress-0")).toBeNull();
  });
});
