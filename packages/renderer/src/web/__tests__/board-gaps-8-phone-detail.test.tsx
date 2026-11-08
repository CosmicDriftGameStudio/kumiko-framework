import { describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { FeatureSchema } from "../../index.ts";
import {
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { DefaultCard } from "../primitives/card.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { DefaultMetric } from "../primitives/metric.tsx";
import { DefaultRecordSteps } from "../primitives/record-steps.tsx";
import { DefaultRecordSummary } from "../primitives/record-summary.tsx";
import { DefaultTabs } from "../primitives/tabs.tsx";
import {
  createMockDispatcher,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  within,
} from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

const cardColumns = [
  { field: "name", label: "Name", type: "string", sortable: false, highlighted: true },
  { field: "unit", label: "Unit", type: "string", sortable: false },
  { field: "rent", label: "Rent", type: "string", sortable: false, narrowInline: true },
  { field: "since", label: "Since", type: "string", sortable: false, narrowInline: true },
] as const;

const cardRows = [
  { id: "r1", values: { name: "Anna", unit: "WE-03", rent: "890 kalt", since: "seit 2023" } },
];

describe("phone card: narrowInline columns", () => {
  restoreViewportWidthAfterEach();

  test("consecutive narrowInline columns share one line, other columns keep their own", () => {
    setViewportWidth(500);
    render(<DataTable columns={cardColumns} rows={cardRows} testId="t" />);
    const vals = screen.getByTestId("card-vals-r1-rent");
    expect(within(vals).getByTestId("cell-r1-rent")).toBeTruthy();
    expect(within(vals).getByTestId("cell-r1-since")).toBeTruthy();
    expect(within(vals).queryByTestId("cell-r1-unit")).toBeNull();
    expect(vals.className).toContain("flex-wrap");
    expect(vals.className).toContain("gap-x-3");
    expect(vals.className).not.toContain("h-5");
    expect(within(vals).getByTestId("cell-r1-rent").className).toContain("max-w-full");
    expect(vals.textContent).not.toContain("·");
  });

  test("without the option every meta column stays on its own line", () => {
    setViewportWidth(500);
    render(<DataTable columns={cardColumns.slice(0, 2)} rows={cardRows} testId="t" />);
    expect(screen.queryByTestId("card-vals-r1-rent")).toBeNull();
  });
});

describe("phone card list footer", () => {
  restoreViewportWidthAfterEach();

  test("a card frame draws the pager as plain text on the page, without bar or border", () => {
    setViewportWidth(500);
    render(
      <DataTable
        columns={cardColumns}
        rows={cardRows}
        frame="card"
        scrollBody
        pager={{ page: 1, limit: 10, total: 26, onPageChange: () => {} }}
        testId="t"
      />,
    );
    const pager = screen.getByTestId("t-pager");
    expect(screen.getByTestId("t-pager-status").textContent).toBe("1–10 of 26");
    expect(pager.className).not.toContain("border-t");
    expect(pager.className).not.toContain("bg-card");
  });

  test("the sort sentence is a muted small line", () => {
    setViewportWidth(500);
    render(
      <DataTable
        columns={cardColumns}
        rows={cardRows}
        frame="card"
        sortOptions={[{ field: "name", dir: "desc", label: "Urgency" }]}
        sort={{ field: "name", dir: "desc" }}
        onSortChange={() => {}}
        itemNoun={() => "contracts"}
        pager={{ page: 1, limit: 10, total: 26, onPageChange: () => {} }}
        testId="t"
      />,
    );
    const sort = screen.getByTestId("t-sort-label");
    expect(sort.textContent).toBe("Sorted by Urgency ↓");
    expect(sort.parentElement?.className).toContain("text-xs");
  });
});

describe("briefing text panel", () => {
  test("the lead sentence is the heading face and the following hint is the dated line under it", async () => {
    const dashboard: DashboardScreenDefinition = {
      id: "today",
      type: "dashboard",
      panels: [
        {
          kind: "text",
          id: "briefing",
          blocks: [
            { kind: "paragraph", text: "Good morning.", emphasis: "lead" },
            { kind: "hint", text: "Tuesday · as of 06:00" },
          ],
        },
      ],
    };
    const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [dashboard] };
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en-US" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <BrowserNav>
          <DispatcherProvider dispatcher={createMockDispatcher()}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="demo:screen:today" />
            </DashboardBodyProvider>
          </DispatcherProvider>
        </BrowserNav>
      </LocaleProvider>,
    );
    const panel = await screen.findByTestId("dashboard-panel-briefing");
    expect(within(panel).getByText("Good morning.").className).toContain("font-heading");
    expect(within(panel).getByText("Tuesday · as of 06:00").className).toContain("text-[11.5px]");
  });
});

describe("phone record page parts", () => {
  restoreViewportWidthAfterEach();

  test("steps are divided rows; the hidden-steps toggle is a grey-striped row in link colour", () => {
    setViewportWidth(500);
    render(
      <DefaultRecordSteps
        title="Next steps"
        emptyLabel="none"
        reasonLabel="Why"
        narrowLimit={1}
        moreLabel={(count) => `${count} more steps`}
        lessLabel="Fewer"
        count={3}
        items={[
          { id: "a", title: "One" },
          { id: "b", title: "Two" },
          { id: "c", title: "Three" },
        ]}
        testId="s"
      />,
    );
    const toggle = screen.getByTestId("s-toggle");
    expect(toggle.textContent).toBe("2 more steps");
    expect(toggle.className).toContain("text-primary");
    expect(screen.getByTestId("record-step-a").parentElement?.className).toContain("divide-y");
    expect(screen.queryByTestId("s-count")).toBeNull();
  });

  test("the summary is the heading-face sentence with the primary stripe at the left", () => {
    render(<DefaultRecordSummary text="Vacant since July." tone="accent" testId="sum" />);
    const summary = screen.getByTestId("sum");
    expect(summary.className).toContain("font-heading");
    expect(summary.className).toContain("border-l-[3px]");
  });

  test("a short sub line stands beside the value on a phone, the long one below on desktop", () => {
    setViewportWidth(500);
    const { unmount } = render(
      <DefaultMetric tile label="Deposit" value="0" sub="of 2,850.00" narrowSub="of 2,850" />,
    );
    expect(screen.getByText("of 2,850").closest("[data-kumiko-layout]")).toBeNull();
    unmount();
    setViewportWidth(1280);
    render(<DefaultMetric tile label="Deposit" value="0" sub="of 2,850.00" narrowSub="of 2,850" />);
    expect(
      screen.getByText("of 2,850.00").closest("[data-kumiko-layout='stat-card-sub']"),
    ).not.toBeNull();
  });

  test("the tab strip scrolls sideways and shows the count as a pill", () => {
    render(
      <DefaultTabs
        items={[
          { id: "a", label: "Master data" },
          { id: "b", label: "Contracts", count: 2 },
        ]}
        activeId="b"
        onSelect={() => {}}
        testId="tabs"
      />,
    );
    const count = screen.getByTestId("tabs-b-count");
    expect(count.className).toContain("rounded-full");
    expect(screen.getByTestId("tabs-b").parentElement?.parentElement?.className).toContain(
      "overflow-x-auto",
    );
  });
});

describe("card with inline header", () => {
  test("title and subtitle share one row and the header draws no divider", () => {
    render(
      <DefaultCard
        slots={{ title: "Re-letting", subtitle: "Step 4 of 6" }}
        options={{ headerLayout: "inline" }}
        testId="c"
      >
        body
      </DefaultCard>,
    );
    const title = screen.getByText("Re-letting");
    const subtitle = screen.getByText("Step 4 of 6");
    expect(title.parentElement).toBe(subtitle.parentElement);
    expect(title.parentElement?.className).toContain("items-baseline");
    expect(title.parentElement?.className).not.toContain("border-b");
  });
});

describe("card inline header content", () => {
  test("headerContent without title still renders and no empty title row appears", () => {
    render(
      <DefaultCard
        slots={{ headerContent: <span>Chips</span> }}
        options={{ headerLayout: "inline" }}
        testId="c"
      >
        body
      </DefaultCard>,
    );
    expect(screen.getByText("Chips")).toBeTruthy();
    expect(screen.getByText("Chips").parentElement?.children).toHaveLength(1);
  });

  test("headerContent sits below the title row", () => {
    render(
      <DefaultCard
        slots={{ title: "Re-letting", headerContent: <span>Chips</span> }}
        options={{ headerLayout: "inline" }}
        testId="c"
      >
        body
      </DefaultCard>,
    );
    const title = screen.getByText("Re-letting");
    const chips = screen.getByText("Chips");
    expect(title.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chips.parentElement).toBe(title.parentElement?.parentElement ?? null);
  });
});
