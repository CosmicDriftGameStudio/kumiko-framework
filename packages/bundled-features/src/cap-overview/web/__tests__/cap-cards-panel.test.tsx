import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  type ExtensionSectionProps,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { DispatcherError } from "@cosmicdrift/kumiko-renderer/headless";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CapUsageTone, CapUsageWithMeta } from "../../types.ts";
import { CapCardsPanel } from "../cap-cards-panel.tsx";
import { CapOverviewQueries } from "../constants.ts";

type CapsUsageResponse = { readonly rows: readonly CapUsageWithMeta[] };

type QueryState = {
  readonly data: CapsUsageResponse | null;
  readonly loading: boolean;
  readonly error: DispatcherError | null;
};

let queryState: QueryState = { data: { rows: [] }, loading: false, error: null };

const useQuerySpy = mock((_type: string, _params: unknown) => ({
  ...queryState,
  refetch: mock(async () => {}),
}));

const actualRenderer = { ...(await import("@cosmicdrift/kumiko-renderer")) };
mockModuleForFile("@cosmicdrift/kumiko-renderer", actualRenderer, {
  useQuery: useQuerySpy,
});

// The real StatusBadge bakes `tone` into a computed Tailwind class string and
// exposes it nowhere in the DOM — asserting TONE_TO_STATUS through it would
// mean matching class substrings. Surface the prop as data-tone instead.
mockModuleForFile(
  "@cosmicdrift/kumiko-renderer/web",
  await import("@cosmicdrift/kumiko-renderer/web"),
  {
    StatusBadge: ({
      tone,
      children,
    }: {
      readonly tone: string;
      readonly children: ReactNode;
    }): ReactNode => <span data-tone={tone}>{children}</span>,
  },
  {
    restoreOverrides: { useQuery: actualRenderer.useQuery },
  },
);

const navigateSpy = mock((_target: unknown) => {});

const navApi: NavApi = {
  route: undefined,
  navigate: navigateSpy,
  replace: () => {},
  hrefFor: (target) => ("screenId" in target ? `/${target.screenId}` : "/"),
  searchParams: {},
  setSearchParams: () => {},
};

const EN_COPY = {
  en: {
    "cap-overview.cards.remaining": "{amount} left",
    "cap-overview.cards.noneLeft": "None left",
    "cap-overview.cards.viewAll": "View all usage",
  },
};

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en-US" })}
      fallbackBundles={[EN_COPY]}
    >
      <NavProvider value={navApi}>
        <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
      </NavProvider>
    </LocaleProvider>
  );
}

function renderPanel(filterParams: ExtensionSectionProps["filterParams"]): void {
  render(
    <Wrapper>
      <CapCardsPanel
        entityName="cap-overview-dashboard"
        entityId={null}
        filterParams={filterParams}
      />
    </Wrapper>,
  );
}

function capRow(overrides: Partial<CapUsageWithMeta> = {}): CapUsageWithMeta {
  return {
    id: "cap-1",
    label: "cap.label",
    tone: "default",
    percent: 0,
    used: 0,
    limit: 100,
    fraction: 0,
    ...overrides,
  };
}

function nullCapRow(overrides: Partial<CapUsageWithMeta> = {}): CapUsageWithMeta {
  return {
    id: "cap-null",
    label: "cap.label.null",
    tone: "default",
    percent: null,
    used: null,
    limit: 100,
    fraction: 0,
    ...overrides,
  };
}

function unlimitedCapRow(overrides: Partial<CapUsageWithMeta> = {}): CapUsageWithMeta {
  return {
    id: "cap-unlimited",
    label: "cap.label.unlimited",
    tone: "default",
    percent: null,
    used: 165,
    limit: null,
    fraction: 0,
    ...overrides,
  };
}

beforeEach(() => {
  queryState = { data: { rows: [] }, loading: false, error: null };
  useQuerySpy.mockClear();
  navigateSpy.mockClear();
});

describe("CapCardsPanel", () => {
  test("renders one card per row, with the row's label and used/limit value", () => {
    queryState = {
      data: {
        rows: [
          capRow({ id: "c1", label: "Storage", used: 3, limit: 10 }),
          capRow({ id: "c2", label: "Seats", used: 7, limit: 20 }),
        ],
      },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getAllByTestId("cap-card")).toHaveLength(2);
    expect(screen.getByText("Storage")).toBeTruthy();
    expect(screen.getByText("Seats")).toBeTruthy();
    expect(screen.getByText("3 / 10")).toBeTruthy();
    expect(screen.getByText("7 / 20")).toBeTruthy();
  });

  test("maps the default tone to the muted StatusBadge tone", () => {
    queryState = {
      data: { rows: [capRow({ tone: "default", percent: 12 })] },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getByText("12%").getAttribute("data-tone")).toBe("muted");
  });

  test("maps the warn tone to the warn StatusBadge tone", () => {
    queryState = {
      data: { rows: [capRow({ tone: "warn", percent: 80 })] },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getByText("80%").getAttribute("data-tone")).toBe("warn");
  });

  test("maps the danger tone to the critical StatusBadge tone", () => {
    const tone: CapUsageTone = "danger";
    queryState = { data: { rows: [capRow({ tone, percent: 99 })] }, loading: false, error: null };

    renderPanel(undefined);

    expect(screen.getByText("99%").getAttribute("data-tone")).toBe("critical");
  });

  test("empty rows without loading show the empty state and no cards", () => {
    queryState = { data: { rows: [] }, loading: false, error: null };

    renderPanel(undefined);

    expect(screen.getByTestId("cap-cards-panel-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("cap-card")).toHaveLength(0);
  });

  test("a query error shows the error banner with the message and no cards", () => {
    queryState = {
      data: null,
      loading: false,
      error: {
        code: "internal",
        httpStatus: 500,
        i18nKey: "kumiko.error.internal",
        message: "caps usage failed",
      },
    };

    renderPanel(undefined);

    expect(screen.getByTestId("cap-cards-panel-error").textContent).toContain("caps usage failed");
    expect(screen.queryAllByTestId("cap-card")).toHaveLength(0);
  });

  test("capKeys in filterParams limits the cards in query order and stays out of the query payload", () => {
    queryState = {
      data: {
        rows: [
          capRow({ id: "users", label: "Seats", used: 1, limit: 5 }),
          capRow({ id: "apps", label: "Apps", used: 2, limit: 3 }),
        ],
      },
      loading: false,
      error: null,
    };

    renderPanel({ capKeys: ["apps", 7, "missing"], tenantId: "t-1" });

    const cards = screen.getAllByTestId("cap-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain("Apps");
    expect(useQuerySpy).toHaveBeenCalledWith(CapOverviewQueries.capsUsage, { tenantId: "t-1" });
  });

  test("a non-array capKeys restricts nothing", () => {
    queryState = {
      data: { rows: [capRow({ id: "apps", label: "Apps", used: 2, limit: 3 })] },
      loading: false,
      error: null,
    };

    renderPanel({ capKeys: "apps" });

    expect(screen.getAllByTestId("cap-card")).toHaveLength(1);
  });

  test("a measured limited cap shows the remaining amount, formatted by unit", () => {
    queryState = {
      data: {
        rows: [
          capRow({ id: "plain", label: "Seats", used: 2, limit: 20 }),
          capRow({ id: "storage", label: "Storage", used: 1024, limit: 5120, unit: "mb" }),
        ],
      },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    const remaining = screen.getAllByTestId("cap-card-remaining").map((node) => node.textContent);
    expect(remaining).toEqual(["18 left", "4 GB left"]);
  });

  test("a cap at or over its limit shows the none-left text", () => {
    queryState = {
      data: { rows: [capRow({ id: "over", label: "Seats", used: 25, limit: 20 })] },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getByTestId("cap-card-remaining").textContent).toBe("None left");
  });

  test("unlimited and not-included caps have no remaining line", () => {
    queryState = {
      data: {
        rows: [unlimitedCapRow(), capRow({ id: "none", label: "Mail", used: 0, limit: 0 })],
      },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getAllByTestId("cap-card")).toHaveLength(2);
    expect(screen.queryByTestId("cap-card-remaining")).toBeNull();
  });

  test("capKeys adds a view-all link to the my-caps screen, no capKeys adds none", () => {
    queryState = {
      data: { rows: [capRow({ id: "apps", label: "Apps", used: 2, limit: 3 })] },
      loading: false,
      error: null,
    };

    renderPanel(undefined);
    expect(screen.queryByTestId("cap-cards-view-all")).toBeNull();
    cleanup();

    renderPanel({ capKeys: ["apps"] });
    const link = screen.getByTestId("cap-cards-view-all");
    expect(link.getAttribute("href")).toBe("/my-caps");
    expect(link.textContent).toBe("View all usage");
    fireEvent.click(link);
    expect(navigateSpy).toHaveBeenCalledWith({ screenId: "my-caps" });
  });

  test("a string tenantId in filterParams is passed through to useQuery", () => {
    renderPanel({ tenantId: "t-42" });

    expect(useQuerySpy).toHaveBeenCalledWith(CapOverviewQueries.capsUsage, { tenantId: "t-42" });
  });

  test("missing or non-string tenantId in filterParams omits the tenantId key", () => {
    renderPanel(undefined);
    const [, undefinedFilterArgs] = useQuerySpy.mock.calls[0] as [string, Record<string, unknown>];
    expect("tenantId" in undefinedFilterArgs).toBe(false);

    useQuerySpy.mockClear();
    renderPanel({ tenantId: 123 });
    const [, numericTenantIdArgs] = useQuerySpy.mock.calls[0] as [string, Record<string, unknown>];
    expect("tenantId" in numericTenantIdArgs).toBe(false);
  });

  test("a card with used: null shows the em-dash value and not-measured text, no bar or percent badge", () => {
    queryState = {
      data: { rows: [nullCapRow()] },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getByTestId("cap-card").textContent).toContain("—");
    expect(screen.getByTestId("cap-usage-not-measured")).toBeTruthy();
    expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
    expect(screen.queryByText("null%")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
  });

  test("a null-usage card and a measured card in the same panel each render their own state", () => {
    queryState = {
      data: {
        rows: [capRow({ id: "c1", label: "Storage", used: 3, limit: 10 }), nullCapRow()],
      },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getAllByTestId("cap-card")).toHaveLength(2);
    expect(screen.getByText("3 / 10")).toBeTruthy();
    expect(screen.getByTestId("cap-usage-not-measured")).toBeTruthy();
    expect(screen.getAllByTestId("cap-usage-bar")).toHaveLength(1);
  });

  test("an unlimited cap (limit: null) shows the raw used count, no denominator, no percent badge, no bar", () => {
    queryState = {
      data: { rows: [unlimitedCapRow()] },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getByTestId("cap-card").textContent).toContain("165");
    expect(screen.queryByText("165 / null")).toBeNull();
    expect(screen.queryByText("165 / 0")).toBeNull();
    expect(screen.queryByText("null%")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
    expect(screen.getByTestId("cap-card").querySelector(".mt-3")).toBeNull();
  });

  test("a limited card and an unlimited card in the same panel each render their own state", () => {
    queryState = {
      data: {
        rows: [
          capRow({ id: "c1", label: "Storage", used: 3, limit: 10, tone: "default", percent: 30 }),
          unlimitedCapRow({ id: "c2", label: "Api calls" }),
        ],
      },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    expect(screen.getAllByTestId("cap-card")).toHaveLength(2);
    expect(screen.getByText("3 / 10")).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getAllByTestId("cap-usage-bar")).toHaveLength(1);
    expect(screen.getAllByTestId("cap-card")[1]?.textContent).toContain("165");
    expect(screen.queryByText("165 / null")).toBeNull();
    expect(screen.queryByText("null%")).toBeNull();
  });

  test("loading with empty rows shows the loading text instead of the empty state", () => {
    queryState = { data: null, loading: true, error: null };

    renderPanel(undefined);

    expect(screen.getByText("cap-overview.cards.loading")).toBeTruthy();
    expect(screen.queryByTestId("cap-cards-panel-empty")).toBeNull();
  });

  test("limit 0 shows the not-included text, no badge, no bar, also when not measured", () => {
    queryState = {
      data: {
        rows: [
          capRow({ id: "c1", used: 0, limit: 0, percent: 0 }),
          nullCapRow({ id: "c2", limit: 0 }),
        ],
      },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    for (const card of screen.getAllByTestId("cap-card")) {
      expect(card.textContent).toContain("cap-overview.notIncluded");
    }
    expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
    expect(screen.queryByTestId("cap-usage-not-measured")).toBeNull();
    expect(screen.queryByText("0%")).toBeNull();
  });

  test("formats values by unit and groups plain numbers", () => {
    queryState = {
      data: {
        rows: [
          capRow({ id: "c1", used: 1536, limit: 102400, percent: 2, unit: "mb" }),
          capRow({ id: "c2", used: 1500, limit: 150000, percent: 1, unit: "count" }),
          unlimitedCapRow({ id: "c3", used: 2048, unit: "mb" }),
        ],
      },
      loading: false,
      error: null,
    };

    renderPanel(undefined);

    const cards = screen.getAllByTestId("cap-card");
    expect(cards[0]?.textContent).toMatch(/1\.5.GB \/ 100.GB/);
    expect(cards[1]?.textContent).toContain("1,500 / 150,000");
    expect(cards[2]?.textContent).toMatch(/2.GB/);
  });
});
