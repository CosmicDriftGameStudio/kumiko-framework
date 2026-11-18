import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { type ColumnRendererProps, ColumnRenderersProvider } from "../../index.ts";
import { defaultPrimitives, END_LABEL_MIN_ROWS, FormScreenShell } from "../primitives/index.tsx";
import { PageSection } from "../primitives/layout.tsx";
import { DataTable, paddingClasses, paddingOf } from "./_primitives-helpers.tsx";
import { fireEvent, render, screen } from "./test-utils.tsx";

function EditableSwatch({ value, column, onChange }: ColumnRendererProps): ReactNode {
  return (
    <input
      data-testid={`edit-${column.field}`}
      value={String(value)}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

describe("DataTable", () => {
  test("facet chips: click selects the chip's values, pressed follows filterValues, hideEmpty drops zero-count chips", () => {
    const onFilterChange = mock();
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[{ id: "r1", values: { name: "A" } }]}
        testId="t"
        filterFacets={[
          {
            field: "status",
            label: "Status",
            options: [],
            showCounts: true,
            hideEmpty: true,
            chips: [
              { id: "all", label: "All", values: [], count: 5 },
              { id: "open", label: "Open", values: ["open"], count: 3 },
              { id: "done", label: "Done", values: ["done"], count: 0 },
            ],
          },
        ]}
        filterValues={{ status: ["open"] }}
        onFilterChange={onFilterChange}
      />,
    );

    expect(screen.queryByTestId("facet-status-done")).toBeNull();
    expect(screen.getByTestId("facet-status-open").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("facet-status-all").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("facet-status-open").textContent).toContain("3");

    fireEvent.click(screen.getByTestId("facet-status-all"));
    expect(onFilterChange).toHaveBeenCalledWith("status", []);
  });

  test("select facet: choosing the active entry again keeps the filter", async () => {
    const onFilterChange = mock();
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[{ id: "r1", values: { name: "A" } }]}
        testId="t"
        filterFacets={[
          {
            field: "status",
            label: "Status",
            options: [],
            display: "select",
            chips: [
              { id: "all", label: "All", values: [] },
              { id: "open", label: "Open", values: ["open"] },
            ],
          },
        ]}
        filterValues={{ status: ["open"] }}
        onFilterChange={onFilterChange}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("facet-status"));
    await user.click(await screen.findByTestId("facet-status-open"));
    expect(onFilterChange).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("facet-status"));
    await user.click(await screen.findByTestId("facet-status-all"));
    expect(onFilterChange).toHaveBeenCalledWith("status", []);
  });

  test("empty rows render empty-state slot with derived testId", () => {
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[]}
        testId="t"
      />,
    );
    // getByTestId throws if missing — existence assertion is implicit.
    screen.getByTestId("t-empty");
  });

  test("empty rows without emptyState translate the default label", async () => {
    const { LocaleProvider, createStaticLocaleResolver, kumikoDefaultTranslations } = await import(
      "../../index.ts"
    );
    const { localeDeBundle } = await import("@cosmicdrift/kumiko-locale-de");
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de" })}
        fallbackBundles={[{ de: localeDeBundle }, kumikoDefaultTranslations]}
      >
        <DataTable
          columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
          rows={[]}
          testId="t"
        />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("t-empty").textContent).toBe("Noch keine Einträge.");
  });

  test("rows + cells get individual testIds for E2E hooks", () => {
    render(
      <DataTable
        columns={[
          { field: "name", label: "Name", type: "string", sortable: false },
          { field: "active", label: "Active", type: "boolean", sortable: false },
        ]}
        rows={[{ id: "r1", values: { name: "Alice", active: true } }]}
        testId="t"
      />,
    );
    screen.getByTestId("row-r1");
    expect(screen.getByTestId("cell-r1-name").textContent).toBe("Alice");
    expect(screen.getByTestId("cell-r1-active").textContent).toBe("Yes");
  });

  test("onRowClick fires with the clicked row", () => {
    const onRowClick = mock();
    const row = { id: "r1", values: { name: "Alice" } };
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[row]}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByTestId("row-r1"));
    expect(onRowClick).toHaveBeenCalledWith(row);
  });

  // chromeless: a relatedList section in a tabs-mode Akte already
  // sits inside a tab panel — the table's own card frame would nest a card
  // inside that boundary without separating anything further.
  describe("chromeless", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const oneRow = [{ id: "r1", values: { name: "Alice" } }];

    // Table itself renders its own [data-slot="table-container"] wrapper div
    // (ui/table.tsx) around the <table data-testid> — the card frame lives
    // one level up, on DefaultDataTable's own wrapping div.
    test("default: table renders with its own card frame", () => {
      render(<DataTable columns={cols} rows={oneRow} testId="t" />);
      const wrapper = screen.getByTestId("t").parentElement?.parentElement;
      expect(wrapper?.className).toContain("border");
      expect(wrapper?.className).toContain("rounded-lg");
      expect(wrapper?.className).toContain("bg-card");
    });

    test("chromeless: table drops the card frame, table markup is unchanged", () => {
      render(<DataTable columns={cols} rows={oneRow} testId="t" chromeless />);
      const wrapper = screen.getByTestId("t").parentElement?.parentElement;
      expect(wrapper?.className).not.toContain("border");
      expect(wrapper?.className).not.toContain("rounded-lg");
      expect(wrapper?.className).not.toContain("bg-card");
      screen.getByTestId("row-r1");
    });
  });

  // scrollBody: a relatedList section in a tabs-mode Akte must not
  // stretch the whole page with a long list, or leave dead space below a
  // short one — bounds the table to a fixed height and scrolls rows inside
  // it, regardless of how many rows there are.
  describe("scrollBody", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const shortRows = [{ id: "r1", values: { name: "Alice" } }];
    const longRows = Array.from({ length: 50 }, (_, i) => ({
      id: `r${i}`,
      values: { name: `Row ${i}` },
    }));

    test("default: table has no fixed height and grows with its content", () => {
      render(<DataTable columns={cols} rows={longRows} testId="t" />);
      const wrapper = screen.getByTestId("t").parentElement?.parentElement;
      expect(wrapper?.className).not.toContain("overflow-y-auto");
      expect(wrapper?.className).toContain("overflow-hidden");
    });

    test("scrollBody: a long list fills its flex container and scrolls internally", () => {
      render(<DataTable columns={cols} rows={longRows} testId="t" scrollBody />);
      const wrapper = screen.getByTestId("t").parentElement?.parentElement;
      expect(wrapper?.className).toContain("overflow-auto");
      expect(wrapper?.className).toContain("flex-1");
      expect(wrapper?.className).toContain("min-h-0");
      expect(screen.getAllByTestId(/^row-/)).toHaveLength(50);
    });

    test("scrollBody: inner scroll surface keeps flex-1 even for a short list (only the outer wrapper sizes to content)", () => {
      render(<DataTable columns={cols} rows={shortRows} testId="t" scrollBody />);
      const wrapper = screen.getByTestId("t").parentElement?.parentElement;
      expect(wrapper?.className).toContain("overflow-auto");
      expect(wrapper?.className).toContain("flex-1");
      expect(wrapper?.className).toContain("min-h-0");
    });

    test("scrollBody: the outer wrapper shrinks (min-h-0) without flex-1, toolbar and pager footer do not shrink", () => {
      render(
        <DataTable
          columns={cols}
          rows={shortRows}
          testId="t"
          scrollBody
          toolbarStart={<input data-testid="search" />}
          pager={{ page: 1, limit: 50, total: 1, onPageChange: mock() }}
        />,
      );
      const toolbar = screen.getByTestId("t-toolbar");
      expect(toolbar.className).toContain("shrink-0");
      const outer = toolbar.parentElement;
      expect(outer?.className).toContain("min-h-0");
      expect(outer?.className).not.toContain("flex-1");
      expect(screen.getByTestId("t-pager").className).toContain("shrink-0");
    });

    test("FillContainer: min-h-0 without flex-1 by default, flex-1 only with grow", () => {
      const { FillContainer } = defaultPrimitives;
      if (FillContainer === undefined) throw new Error("defaultPrimitives has no FillContainer");
      render(
        <>
          <FillContainer testId="fill-default">x</FillContainer>
          <FillContainer testId="fill-grow" grow>
            x
          </FillContainer>
        </>,
      );
      const plain = screen.getByTestId("fill-default").className;
      expect(plain).toContain("min-h-0");
      expect(plain).not.toContain("flex-1");
      const grown = screen.getByTestId("fill-grow").className;
      expect(grown).toContain("min-h-0");
      expect(grown).toContain("flex-1");
    });
  });

  // The sort header pins the 3-state toggle behavior + visual indicator
  // + aria-sort. Renderer contract with the caller (RenderList): every
  // sortable column returns the next sort state on click, and the caller
  // uses it to set URL state and refetch.
  describe("Sort-Header", () => {
    const sortableCols = [
      { field: "name", label: "Name", type: "string", sortable: true },
      { field: "createdAt", label: "Created", type: "timestamp", sortable: true },
      { field: "id", label: "ID", type: "string", sortable: false },
    ] as const;
    // At least one row, otherwise DefaultDataTable renders the empty-state
    // branch and the thead markup is not in the DOM at all.
    // The sort header lives in thead, which we need here.
    const oneRow = [{ id: "r1", values: { name: "A", createdAt: "2026-01-01", id: "r1" } }];

    test("without onSortChange: header remains plain (no button, no cursor)", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} />);
      // Plain th.textContent contains the label. NO button inside.
      expect(screen.getByTestId("column-name").querySelector("button")).toBeNull();
    });

    test("with onSortChange: sortable column renders Button + ArrowUpDown icon", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={mock()} />);
      const header = screen.getByTestId("column-name");
      expect(header.querySelector("button")).not.toBeNull();
      // Default icon (no active sort) is ArrowUpDown; Lucide renders the
      // svg without an explicit name, so we check aria-sort='none'.
      expect(header.getAttribute("aria-sort")).toBe("none");
    });

    test("non-sortable column renders no button (even with onSortChange)", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={mock()} />);
      expect(screen.getByTestId("column-id").querySelector("button")).toBeNull();
    });

    test("aria-sort=ascending when sort.field matches + dir=asc", () => {
      render(
        <DataTable
          columns={sortableCols}
          rows={oneRow}
          sort={{ field: "name", dir: "asc" }}
          onSortChange={mock()}
        />,
      );
      expect(screen.getByTestId("column-name").getAttribute("aria-sort")).toBe("ascending");
      expect(screen.getByTestId("column-createdAt").getAttribute("aria-sort")).toBe("none");
    });

    test("aria-sort=descending when dir=desc", () => {
      render(
        <DataTable
          columns={sortableCols}
          rows={oneRow}
          sort={{ field: "name", dir: "desc" }}
          onSortChange={mock()}
        />,
      );
      expect(screen.getByTestId("column-name").getAttribute("aria-sort")).toBe("descending");
    });

    test("Click without active sort: onSortChange({field, dir:'asc'})", () => {
      const onSortChange = mock();
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTestId("column-name").querySelector("button") as HTMLElement);
      expect(onSortChange).toHaveBeenCalledWith({ field: "name", dir: "asc" });
    });

    test("Click with active asc: onSortChange({field, dir:'desc'})", () => {
      const onSortChange = mock();
      render(
        <DataTable
          columns={sortableCols}
          rows={oneRow}
          sort={{ field: "name", dir: "asc" }}
          onSortChange={onSortChange}
        />,
      );
      fireEvent.click(screen.getByTestId("column-name").querySelector("button") as HTMLElement);
      expect(onSortChange).toHaveBeenCalledWith({ field: "name", dir: "desc" });
    });

    test("Click with active desc: onSortChange(null) (3-state back to unsorted)", () => {
      const onSortChange = mock();
      render(
        <DataTable
          columns={sortableCols}
          rows={oneRow}
          sort={{ field: "name", dir: "desc" }}
          onSortChange={onSortChange}
        />,
      );
      fireEvent.click(screen.getByTestId("column-name").querySelector("button") as HTMLElement);
      expect(onSortChange).toHaveBeenCalledWith(null);
    });

    test("Clicking another column (sort=null for it): starts at asc", () => {
      const onSortChange = mock();
      render(
        <DataTable
          columns={sortableCols}
          rows={oneRow}
          sort={{ field: "name", dir: "desc" }}
          onSortChange={onSortChange}
        />,
      );
      fireEvent.click(
        screen.getByTestId("column-createdAt").querySelector("button") as HTMLElement,
      );
      // Other column: it has no active sort, so asc.
      expect(onSortChange).toHaveBeenCalledWith({ field: "createdAt", dir: "asc" });
    });
  });

  // Pager: status on the left, "Page X of Y", prev/next. Server wiring
  // (offset etc.) lives in KumikoScreen; only the UI here.
  describe("Pager", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const oneRow = [{ id: "r1", values: { name: "A" } }];

    test("without pager prop: no pager in the DOM", () => {
      render(<DataTable columns={cols} rows={oneRow} testId="dt" />);
      expect(screen.queryByTestId("dt-pager")).toBeNull();
    });

    test("pager with total=0: the footer stays with 0 of 0 and disabled paging", () => {
      render(
        <DataTable
          columns={cols}
          rows={[]}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 0, onPageChange: mock() }}
        />,
      );
      screen.getByTestId("dt-pager");
      expect(screen.getByTestId("dt-pager-status").textContent).toBe("0 of 0");
      expect((screen.getByTestId("dt-pager-prev") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId("dt-pager-next") as HTMLButtonElement).disabled).toBe(true);
    });

    test("page=1: Prev-Button disabled, Next aktiv", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 3000, onPageChange: mock() }}
        />,
      );
      expect((screen.getByTestId("dt-pager-prev") as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByTestId("dt-pager-next") as HTMLButtonElement).disabled).toBe(false);
    });

    test("page=last: Next-Button disabled", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 60, limit: 50, total: 3000, onPageChange: mock() }}
        />,
      );
      expect((screen.getByTestId("dt-pager-next") as HTMLButtonElement).disabled).toBe(true);
    });

    test("Clicking Next on page=1: onPageChange(2)", () => {
      const onPageChange = mock();
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 3000, onPageChange }}
        />,
      );
      fireEvent.click(screen.getByTestId("dt-pager-next"));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    test("Clicking Prev on page=3: onPageChange(2)", () => {
      const onPageChange = mock();
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 3, limit: 50, total: 3000, onPageChange }}
        />,
      );
      fireEvent.click(screen.getByTestId("dt-pager-prev"));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    test("Default locale (en): status, page X of Y, and aria labels from i18n fallback", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 2, limit: 50, total: 3000, onPageChange: mock() }}
        />,
      );
      expect(screen.getByTestId("dt-pager-status").textContent).toBe("51–100 of 3,000");
      expect(screen.getByTestId("dt-pager-page-label").textContent).toBe("Page 2 of 60");
      expect(screen.getByTestId("dt-pager-prev").getAttribute("aria-label")).toBe("Previous page");
      expect(screen.getByTestId("dt-pager-next").getAttribute("aria-label")).toBe("Next page");
    });

    test("de locale: status, page X of Y, and aria labels come from i18n instead of hardcoded English", async () => {
      const { LocaleProvider, createStaticLocaleResolver, kumikoDefaultTranslations } =
        await import("../../index.ts");
      const { localeDeBundle } = await import("@cosmicdrift/kumiko-locale-de");
      render(
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "de" })}
          fallbackBundles={[{ de: localeDeBundle }, kumikoDefaultTranslations]}
        >
          <DataTable
            columns={cols}
            rows={oneRow}
            testId="dt"
            pager={{ page: 1, limit: 50, total: 3000, onPageChange: mock() }}
          />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("dt-pager-status").textContent).toBe("1–50 von 3.000");
      expect(screen.getByTestId("dt-pager-page-label").textContent).toBe("Seite 1 von 60");
      expect(screen.getByTestId("dt-pager-prev").getAttribute("aria-label")).toBe(
        "Vorherige Seite",
      );
      expect(screen.getByTestId("dt-pager-next").getAttribute("aria-label")).toBe("Nächste Seite");
    });
  });

  // scrollBody: toolbar and footer are pinned outside the scroll surface, so
  // the footer sits at the same spot at any row count.
  describe("scrollBody layout", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const threeRows = [1, 2, 3].map((n) => ({ id: `r${n}`, values: { name: `A${n}` } }));

    test("Pager is a sibling of the scroll container, not its child", () => {
      render(
        <DataTable
          columns={cols}
          rows={threeRows}
          testId="dt"
          scrollBody
          pager={{ page: 1, limit: 50, total: 3, onPageChange: mock() }}
        />,
      );
      const scroll = screen.getByTestId("dt-scroll");
      const pager = screen.getByTestId("dt-pager");
      expect(scroll.contains(pager)).toBe(false);
      expect(scroll.parentElement).toBe(pager.parentElement);
      expect(scroll.contains(screen.getByTestId("dt"))).toBe(true);
    });

    test("the scroll container is positioned, so absolutely placed sr-only cell labels cannot widen the page", () => {
      render(<DataTable columns={cols} rows={threeRows} testId="dt" scrollBody />);
      expect(screen.getByTestId("dt-scroll").classList.contains("relative")).toBe(true);
    });

    test("without scrollBody, the pager remains unchanged below the table, without a scroll container", () => {
      render(
        <DataTable
          columns={cols}
          rows={threeRows}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 3, onPageChange: mock() }}
        />,
      );
      expect(screen.queryByTestId("dt-scroll")).toBeNull();
      screen.getByTestId("dt-pager");
    });

    test("without a pager, the footer shows the count (singular and plural)", () => {
      const { rerender } = render(
        <DataTable columns={cols} rows={threeRows} testId="dt" scrollBody />,
      );
      expect(screen.getByTestId("dt-footer-count").textContent).toBe("3 entries");
      rerender(<DataTable columns={cols} rows={threeRows.slice(0, 1)} testId="dt" scrollBody />);
      expect(screen.getByTestId("dt-footer-count").textContent).toBe("1 entry");
    });

    test("Footer remains visible with 0 rows, empty state is in the scroll container", () => {
      render(<DataTable columns={cols} rows={[]} testId="dt" scrollBody />);
      expect(screen.getByTestId("dt-footer-count").textContent).toBe("0 entries");
      expect(screen.getByTestId("dt-scroll").contains(screen.getByTestId("dt-empty"))).toBe(true);
      expect(screen.getByTestId("dt-scroll").contains(screen.getByTestId("dt-footer"))).toBe(false);
    });

    test("infinite: sentinel is in the scroll container, footer counts the loaded rows", () => {
      render(
        <DataTable
          columns={cols}
          rows={threeRows}
          testId="dt"
          scrollBody
          onReachEnd={mock()}
          hasMore
        />,
      );
      expect(screen.getByTestId("dt-scroll").contains(screen.getByTestId("dt-sentinel"))).toBe(
        true,
      );
      expect(screen.getByTestId("dt-footer-count").textContent).toBe("3 entries");
    });

    test("without scrollBody, there is no count footer", () => {
      render(<DataTable columns={cols} rows={threeRows} testId="dt" />);
      expect(screen.queryByTestId("dt-footer")).toBeNull();
    });
  });

  // Infinite-scroll sentinel: renders a sentinel div, shows a spinner when
  // loadingMore, and the i18n end-of-list marker (kumiko.list.end-of-list)
  // when !hasMore and enough rows have loaded (short lists don't need a
  // marker — they show their end on their own). IntersectionObserver itself
  // is unmocked in jsdom — we only test the marker; the observer-fire path
  // lives in KumikoScreen.EntityListBody.
  describe("InfiniteSentinel", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const oneRow = [{ id: "r1", values: { name: "A" } }];
    // 60 rows — above END_LABEL_MIN_ROWS (50, the framework default pageSize)
    // so hasMore=false genuinely means "reached the end of a full default
    // page". 25 used to pass here too, back when the threshold was a
    // mismatched 20 — that under-a-page case is now covered
    // separately below by the exact-boundary tests.
    const manyRows = Array.from({ length: 60 }, (_, i) => ({
      id: `r${i}`,
      values: { name: `A${i}` },
    }));
    const rowsOfCount = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `r${i}`, values: { name: `A${i}` } }));

    test("without onReachEnd: no sentinel in the DOM", () => {
      render(<DataTable columns={cols} rows={oneRow} testId="dt" />);
      expect(screen.queryByTestId("dt-sentinel")).toBeNull();
    });

    test("with onReachEnd + hasMore=true + loadingMore=false: empty sentinel", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          onReachEnd={mock()}
          loadingMore={false}
          hasMore={true}
        />,
      );
      const sentinel = screen.getByTestId("dt-sentinel");
      // Neither end marker nor spinner: the sentinel waits for the
      // observer fire (pre-fetch via rootMargin: 200px).
      expect(sentinel.querySelector("svg")).toBeNull();
      expect(screen.queryByTestId("dt-sentinel-end")).toBeNull();
    });

    test("loadingMore=true: Spinner sichtbar", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          onReachEnd={mock()}
          loadingMore={true}
          hasMore={true}
        />,
      );
      expect(screen.getByTestId("dt-sentinel").querySelector("svg")).not.toBeNull();
    });

    test("hasMore=false + many rows: 'End of list' marker instead of sentinel behavior", () => {
      render(
        <DataTable
          columns={cols}
          rows={manyRows}
          testId="dt"
          onReachEnd={mock()}
          loadingMore={false}
          hasMore={false}
        />,
      );
      screen.getByTestId("dt-sentinel-end");
      expect(screen.getByTestId("dt-sentinel-end").textContent).toContain("End of list");
    });

    test("hasMore=false + short list: no end marker", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          onReachEnd={mock()}
          loadingMore={false}
          hasMore={false}
        />,
      );
      expect(screen.queryByTestId("dt-sentinel-end")).toBeNull();
      expect(screen.getByTestId("dt-sentinel").textContent).toBe("");
    });

    test(`hasMore=false + ${END_LABEL_MIN_ROWS - 1} rows: no end marker (edge case below threshold)`, () => {
      render(
        <DataTable
          columns={cols}
          rows={rowsOfCount(END_LABEL_MIN_ROWS - 1)}
          testId="dt"
          onReachEnd={mock()}
          loadingMore={false}
          hasMore={false}
        />,
      );
      expect(screen.queryByTestId("dt-sentinel-end")).toBeNull();
    });

    test(`hasMore=false + ${END_LABEL_MIN_ROWS} rows: End marker (threshold boundary case)`, () => {
      render(
        <DataTable
          columns={cols}
          rows={rowsOfCount(END_LABEL_MIN_ROWS)}
          testId="dt"
          onReachEnd={mock()}
          loadingMore={false}
          hasMore={false}
        />,
      );
      screen.getByTestId("dt-sentinel-end");
    });

    test("hasMore=false + de locale: marker comes from i18n instead of being hardcoded", async () => {
      const { LocaleProvider, createStaticLocaleResolver, kumikoDefaultTranslations } =
        await import("../../index.ts");
      const { localeDeBundle } = await import("@cosmicdrift/kumiko-locale-de");
      render(
        <LocaleProvider
          resolver={createStaticLocaleResolver({ locale: "de" })}
          fallbackBundles={[{ de: localeDeBundle }, kumikoDefaultTranslations]}
        >
          <DataTable
            columns={cols}
            rows={manyRows}
            testId="dt"
            onReachEnd={mock()}
            loadingMore={false}
            hasMore={false}
          />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("dt-sentinel-end").textContent).toBe("— Ende der Liste —");
    });
  });

  describe("highlighted column", () => {
    const cols = [
      { field: "name", label: "Name", type: "string", sortable: false },
      { field: "y2026", label: "2026", type: "number", sortable: false, highlighted: true },
    ] as const;
    const oneRow = [{ id: "r1", values: { name: "Alice", y2026: 42 } }];

    test("marks header + cell of the highlighted column, leaves others alone", () => {
      render(<DataTable columns={cols} rows={oneRow} />);
      expect(screen.getByTestId("column-y2026").getAttribute("data-highlighted")).toBe("true");
      expect(screen.getByTestId("column-name").getAttribute("data-highlighted")).toBeNull();
      expect(screen.getByTestId("cell-r1-y2026").getAttribute("data-highlighted")).toBe("true");
      expect(screen.getByTestId("cell-r1-name").getAttribute("data-highlighted")).toBeNull();
    });

    test("marks the header of a highlighted sortable column too", () => {
      const sortableCols = [
        { field: "name", label: "Name", type: "string", sortable: false },
        { field: "y2026", label: "2026", type: "number", sortable: true, highlighted: true },
      ] as const;
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={mock()} />);
      expect(screen.getByTestId("column-y2026").getAttribute("data-highlighted")).toBe("true");
      expect(screen.getByTestId("column-name").getAttribute("data-highlighted")).toBeNull();
    });
  });

  describe("testId overrides", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const oneRow = [{ id: "r1", values: { name: "Alice" } }];

    test("getRowTestId/getCellTestId override the row-<id>/cell-<id>-<field> defaults", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          getRowTestId={(row) => `own-row-${row.id}`}
          getCellTestId={(row, field) => `own-cell-${row.id}-${field}`}
        />,
      );
      screen.getByTestId("own-row-r1");
      screen.getByTestId("own-cell-r1-name");
      expect(screen.queryByTestId("row-r1")).toBeNull();
    });

    test("without overrides, defaults stay row-<id>/cell-<id>-<field>", () => {
      render(<DataTable columns={cols} rows={oneRow} />);
      screen.getByTestId("row-r1");
      screen.getByTestId("cell-r1-name");
    });
  });

  describe("onCellChange (editable cell)", () => {
    test("column-renderer receives onChange bound to (rowId, field, value) when onCellChange is set", () => {
      const onCellChange = mock();
      const cols = [
        {
          field: "name",
          label: "Name",
          type: "string",
          sortable: false,
          renderer: { react: { __component: "EditableSwatch" } },
        },
      ] as const;
      render(
        <ColumnRenderersProvider value={{ EditableSwatch }}>
          <DataTable
            columns={cols}
            rows={[{ id: "r1", values: { name: "Alice" } }]}
            onCellChange={onCellChange}
          />
        </ColumnRenderersProvider>,
      );
      fireEvent.change(screen.getByTestId("edit-name"), { target: { value: "Bob" } });
      expect(onCellChange).toHaveBeenCalledWith("r1", "name", "Bob");
    });

    test("without onCellChange, the component renderer gets no onChange (read-only)", () => {
      const cols = [
        {
          field: "name",
          label: "Name",
          type: "string",
          sortable: false,
          renderer: { react: { __component: "EditableSwatch" } },
        },
      ] as const;
      render(
        <ColumnRenderersProvider value={{ EditableSwatch }}>
          <DataTable columns={cols} rows={[{ id: "r1", values: { name: "Alice" } }]} />
        </ColumnRenderersProvider>,
      );
      // onChange is undefined → EditableSwatch's onChange?.(...) is a no-op;
      // rendering itself must still succeed (no crash) with a stable value.
      expect((screen.getByTestId("edit-name") as HTMLInputElement).value).toBe("Alice");
    });

    test("plain cell still fires onRowClick when onCellChange is set (stopPropagation only on editable)", () => {
      const onRowClick = mock();
      const onCellChange = mock();
      const cols = [
        {
          field: "name",
          label: "Name",
          type: "string",
          sortable: false,
        },
        {
          field: "edit",
          label: "Edit",
          type: "string",
          sortable: false,
          renderer: { react: { __component: "EditableSwatch" } },
        },
      ] as const;
      render(
        <ColumnRenderersProvider value={{ EditableSwatch }}>
          <DataTable
            columns={cols}
            rows={[{ id: "r1", values: { name: "Alice", edit: "x" } }]}
            onRowClick={onRowClick}
            onCellChange={onCellChange}
          />
        </ColumnRenderersProvider>,
      );
      fireEvent.click(screen.getByTestId("cell-r1-name"));
      expect(onRowClick).toHaveBeenCalled();
    });

    test("format-spec renderer ignores onCellChange — no crash, plain formatted text", () => {
      const onCellChange = mock();
      const cols = [
        {
          field: "amount",
          label: "Amount",
          type: "number",
          sortable: false,
          renderer: { format: "currency", currency: "EUR", locale: "de-DE" },
        },
      ] as const;
      render(
        <DataTable
          columns={cols}
          rows={[{ id: "r1", values: { amount: 4200 } }]}
          onCellChange={onCellChange}
        />,
      );
      expect(screen.getByTestId("cell-r1-amount").textContent).toBe("42,00\u00a0€");
      expect(onCellChange).not.toHaveBeenCalled();
    });
  });
});

describe("DataTable toolbar slots", () => {
  test("toolbarStart + toolbarEnd render in one row; title is not rendered (it is in the breadcrumb)", () => {
    render(
      <DataTable
        columns={[]}
        rows={[]}
        toolbarTitle="Items"
        toolbarStart={<input data-testid="search" />}
        toolbarEnd={
          <button type="button" data-testid="create">
            + Neu
          </button>
        }
        testId="dt"
      />,
    );
    const toolbar = screen.getByTestId("dt-toolbar");
    // The screen title lives in the shell breadcrumb, no longer in the toolbar.
    expect(toolbar.textContent).not.toContain("Items");
    expect(toolbar.querySelector('[data-testid="search"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="create"]')).not.toBeNull();
  });

  test("without toolbar slots, no toolbar container is rendered", () => {
    render(<DataTable columns={[]} rows={[]} testId="dt" />);
    expect(screen.queryByTestId("dt-toolbar")).toBeNull();
  });
});

// A list screen has no PageSection/FormScreenShell around it — its screen
// chrome is DataTable's own outer wrapper, which is why that wrapper had its
// own inset and list screens ended 24px above the viewport edge instead of
// 48px.
describe("DataTable screenPadding", () => {
  const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
  const oneRow = [{ id: "r1", values: { name: "Alice" } }];
  // table → [data-slot="table-container"] → card frame → padding wrapper.
  const paddingWrapperOf = (testId: string): Element | null | undefined =>
    screen.getByTestId(testId).parentElement?.parentElement?.parentElement;

  test("screenPadding: the table's screen chrome matches PageSection and FormScreenShell", () => {
    render(
      <>
        <PageSection testId="page-pad">x</PageSection>
        <FormScreenShell testId="shell-pad">x</FormScreenShell>
        <DataTable columns={cols} rows={oneRow} testId="list-table" screenPadding />
      </>,
    );
    expect(paddingClasses(paddingWrapperOf("list-table"))).toEqual(paddingOf("page-pad"));
    expect(paddingClasses(paddingWrapperOf("list-table"))).toEqual(paddingOf("shell-pad"));
  });

  test("default: an embedded table keeps its symmetric inset (relatedList unchanged)", () => {
    render(<DataTable columns={cols} rows={oneRow} testId="embedded-table" />);
    expect(paddingClasses(paddingWrapperOf("embedded-table"))).toEqual(["p-6"]);
  });

  // A relatedList section nested in a tabs-mode Card already
  // sits inside the Card's own padded body — DataTable's own p-6 wrapper then
  // pushed the table 24px deeper than a sibling Banner in the same Card,
  // visibly misaligning their left edges.
  test("screenPadding=false: no wrapper inset at all (host Card already pads)", () => {
    render(<DataTable columns={cols} rows={oneRow} testId="flush-table" screenPadding={false} />);
    expect(paddingClasses(paddingWrapperOf("flush-table"))).toEqual([]);
  });

  test("scrollBody wins over screenPadding: the wrapper fills its container without the screen inset", () => {
    const { container } = render(
      <DataTable columns={cols} rows={oneRow} testId="both-table" scrollBody screenPadding />,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("h-full");
    expect(paddingClasses(wrapper)).toEqual([]);
  });
});
