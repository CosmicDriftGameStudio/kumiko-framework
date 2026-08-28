// @runtime test
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  type ExtensionSectionProps,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CapOverviewQueries } from "../../constants";
import type { CapUsageTone, CapUsageWithMeta } from "../../types";
import { CapCardsPanel } from "../cap-cards-panel";

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

const actualRenderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actualRenderer,
  useQuery: useQuerySpy,
}));

// The real StatusBadge bakes `tone` into a computed Tailwind class string and
// exposes it nowhere in the DOM — asserting TONE_TO_STATUS through it would
// mean matching class substrings. Surface the prop as data-tone instead.
const actualRendererWeb = await import("@cosmicdrift/kumiko-renderer-web");
mock.module("@cosmicdrift/kumiko-renderer-web", () => ({
  ...actualRendererWeb,
  StatusBadge: ({
    tone,
    children,
  }: {
    readonly tone: string;
    readonly children: ReactNode;
  }): ReactNode => <span data-tone={tone}>{children}</span>,
}));

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
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

beforeEach(() => {
  queryState = { data: { rows: [] }, loading: false, error: null };
  useQuerySpy.mockClear();
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

  test("loading with empty rows shows the loading text instead of the empty state", () => {
    queryState = { data: null, loading: true, error: null };

    renderPanel(undefined);

    expect(screen.getByText("cap-overview.cards.loading")).toBeTruthy();
    expect(screen.queryByTestId("cap-cards-panel-empty")).toBeNull();
  });
});
