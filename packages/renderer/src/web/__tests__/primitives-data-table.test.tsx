import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { type ColumnRendererProps, ColumnRenderersProvider } from "../../index.ts";
import { defaultPrimitives, END_LABEL_MIN_ROWS, FormScreenShell } from "../primitives/index.tsx";
import { PageSection } from "../primitives/layout.tsx";
import { DataTable, paddingClasses, paddingOf } from "./_primitives-helpers.tsx";
import { fireEvent, render, screen, waitFor, within } from "./test-utils.tsx";

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

  test("empty rows render empty-state slot with derived testId", () => {
    render(
      <DataTable
        columns={[{ field: "name", label: "Name", type: "string", sortable: false }]}
        rows={[]}
        testId="t"
      />,
    );
    // getByTestId throws if missing — existence assertion is implicit.
    expect(screen.getByTestId("t-empty")).not.toBeNull();
  });

  test("empty rows without emptyState translate the default label (issue #2653)", async () => {
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
    expect(screen.getByTestId("row-r1")).not.toBeNull();
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
      expect(screen.getByTestId("row-r1")).not.toBeNull();
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

    test("scrollBody: inner scroll surface keeps flex-1 even for a short list (fw#2778: only the outer wrapper sizes to content)", () => {
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

    test("ohne onSortChange: Header bleibt plain (kein Button, kein cursor)", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} />);
      // Plain th.textContent contains the label. NO button inside.
      expect(screen.getByTestId("column-name").querySelector("button")).toBeNull();
    });

    test("mit onSortChange: sortable-Column rendert Button + ArrowUpDown-Icon", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={mock()} />);
      const header = screen.getByTestId("column-name");
      expect(header.querySelector("button")).not.toBeNull();
      // Default icon (no active sort) is ArrowUpDown; Lucide renders the
      // svg without an explicit name, so we check aria-sort='none'.
      expect(header.getAttribute("aria-sort")).toBe("none");
    });

    test("non-sortable Column rendert KEINEN Button (auch mit onSortChange)", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={mock()} />);
      expect(screen.getByTestId("column-id").querySelector("button")).toBeNull();
    });

    test("aria-sort=ascending wenn sort.field passt + dir=asc", () => {
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

    test("aria-sort=descending wenn dir=desc", () => {
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

    test("Click ohne aktiven Sort: onSortChange({field, dir:'asc'})", () => {
      const onSortChange = mock();
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTestId("column-name").querySelector("button") as HTMLElement);
      expect(onSortChange).toHaveBeenCalledWith({ field: "name", dir: "asc" });
    });

    test("Click mit aktivem asc: onSortChange({field, dir:'desc'})", () => {
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

    test("Click mit aktivem desc: onSortChange(null) (3-State zurück zu unsorted)", () => {
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

    test("Click auf andere Spalte (sort=null für die): startet bei asc", () => {
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

    test("ohne pager-prop: kein Pager im DOM", () => {
      render(<DataTable columns={cols} rows={oneRow} testId="dt" />);
      expect(screen.queryByTestId("dt-pager")).toBeNull();
    });

    test("pager mit total=0: kein Pager (nichts zu paginieren)", () => {
      render(
        <DataTable
          columns={cols}
          rows={[]}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 0, onPageChange: mock() }}
        />,
      );
      expect(screen.queryByTestId("dt-pager")).toBeNull();
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

    test("Click auf Next von page=1: onPageChange(2)", () => {
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

    test("Click auf Prev von page=3: onPageChange(2)", () => {
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

    test("keine nummerierte Seitenliste: nur Prev/Next-Buttons", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 30, limit: 50, total: 3000, onPageChange: mock() }}
        />,
      );
      expect(screen.getByTestId("dt-pager").querySelectorAll("button")).toHaveLength(2);
      expect(screen.queryByText("…")).toBeNull();
    });

    test("Default-Locale (en): Status, Seite X von Y und aria-Labels aus i18n-Fallback", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 2, limit: 50, total: 3000, onPageChange: mock() }}
        />,
      );
      expect(screen.getByTestId("dt-pager-status").textContent).toBe("51–100 of 3,000");
      expect(screen.getByTestId("dt-pager").textContent).toContain("Page 2 of 60");
      expect(screen.getByTestId("dt-pager-prev").getAttribute("aria-label")).toBe("Previous page");
      expect(screen.getByTestId("dt-pager-next").getAttribute("aria-label")).toBe("Next page");
    });

    test("de-Locale: Status, Seite X von Y und aria-Labels kommen aus i18n statt hartcodiertem Englisch (issue #2007)", async () => {
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
      // toLocaleString() without a locale arg stays runtime-default (not the
      // resolver locale) — this only addresses the untranslated word/aria-labels.
      expect(screen.getByTestId("dt-pager-status").textContent).toBe("1–50 von 3,000");
      expect(screen.getByTestId("dt-pager").textContent).toContain("Seite 1 von 60");
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

    test("Pager ist Geschwister des Scroll-Containers, nicht sein Kind", () => {
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

    test("ohne scrollBody bleibt der Pager unverändert unter der Tabelle, ohne Scroll-Container", () => {
      render(
        <DataTable
          columns={cols}
          rows={threeRows}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 3, onPageChange: mock() }}
        />,
      );
      expect(screen.queryByTestId("dt-scroll")).toBeNull();
      expect(screen.getByTestId("dt-pager")).not.toBeNull();
    });

    test("ohne Pager zeigt der Footer die Anzahl (Singular und Plural)", () => {
      const { rerender } = render(
        <DataTable columns={cols} rows={threeRows} testId="dt" scrollBody />,
      );
      expect(screen.getByTestId("dt-footer-count").textContent).toBe("3 entries");
      rerender(<DataTable columns={cols} rows={threeRows.slice(0, 1)} testId="dt" scrollBody />);
      expect(screen.getByTestId("dt-footer-count").textContent).toBe("1 entry");
    });

    test("Footer bleibt bei 0 Zeilen stehen, Empty-State liegt im Scroll-Container", () => {
      render(<DataTable columns={cols} rows={[]} testId="dt" scrollBody />);
      expect(screen.getByTestId("dt-footer-count").textContent).toBe("0 entries");
      expect(screen.getByTestId("dt-scroll").contains(screen.getByTestId("dt-empty"))).toBe(true);
      expect(screen.getByTestId("dt-scroll").contains(screen.getByTestId("dt-footer"))).toBe(false);
    });

    test("infinite: Sentinel liegt im Scroll-Container, Footer zählt die geladenen Zeilen", () => {
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

    test("ohne scrollBody gibt es keinen Anzahl-Footer", () => {
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

    test("ohne onReachEnd: kein Sentinel im DOM", () => {
      render(<DataTable columns={cols} rows={oneRow} testId="dt" />);
      expect(screen.queryByTestId("dt-sentinel")).toBeNull();
    });

    test("mit onReachEnd + hasMore=true + loadingMore=false: leerer Sentinel", () => {
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

    test("hasMore=false + viele Zeilen: 'End of list' Marker statt Sentinel-Wirkung", () => {
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
      expect(screen.getByTestId("dt-sentinel-end")).not.toBeNull();
      expect(screen.getByTestId("dt-sentinel-end").textContent).toContain("End of list");
    });

    test("hasMore=false + kurze Liste: kein End-Marker (#1699)", () => {
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

    test(`hasMore=false + ${END_LABEL_MIN_ROWS - 1} Zeilen: kein End-Marker (Grenzfall unter Threshold)`, () => {
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

    test(`hasMore=false + ${END_LABEL_MIN_ROWS} Zeilen: End-Marker (Grenzfall auf Threshold)`, () => {
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
      expect(screen.getByTestId("dt-sentinel-end")).not.toBeNull();
    });

    test("hasMore=false + de-Locale: Marker kommt aus i18n statt hartcodiert", async () => {
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

  // RowActions: pins the inline-vs-kebab decision, the confirm dialog
  // on style=danger, per-row visibility filter and onTrigger wiring.
  describe("RowActions", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const rows = [
      { id: "r1", values: { id: "r1", name: "Alpha" } },
      { id: "r2", values: { id: "r2", name: "Beta" } },
    ];

    test("ohne rowActions: keine Actions-Spalte im Header", () => {
      render(<DataTable columns={cols} rows={rows} testId="dt" />);
      expect(screen.queryByTestId("column-actions")).toBeNull();
      expect(screen.queryByTestId("cell-r1-actions")).toBeNull();
    });

    test("mit rowActions: Actions-Spalte gerendert", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[{ id: "edit", label: "Edit", onTrigger: mock() }]}
        />,
      );
      expect(screen.queryByTestId("column-actions")).not.toBeNull();
      expect(screen.queryByTestId("cell-r1-actions")).not.toBeNull();
    });

    test("2 Actions ohne onRowClick: primäre inline, die andere im Kebab", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "edit", label: "Edit", onTrigger: mock() },
            { id: "delete", label: "Delete", style: "danger", onTrigger: mock() },
          ]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-edit")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-delete")).toBeNull();
      expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
    });

    test("einzelne Aktion ohne onRowClick: Link-Button, kein Kebab", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[{ id: "edit", label: "Edit", onTrigger: mock() }]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-edit")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
    });

    test("mit onRowClick: erste Zelle ist fokussierbar, Enter öffnet, Aktionen nur im Kebab", async () => {
      const user = userEvent.setup();
      const onRowClick = mock();
      const onTrigger = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={onRowClick}
          rowActions={[{ id: "edit", label: "Edit", onTrigger }]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-edit")).toBeNull();
      const firstCellButton = within(screen.getByTestId("cell-r1-name")).getByRole("button");
      firstCellButton.focus();
      expect(document.activeElement).toBe(firstCellButton);
      fireEvent.keyDown(firstCellButton, { key: "Enter" });
      expect(onRowClick).toHaveBeenCalledTimes(1);
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(await screen.findByTestId("row-r1-action-edit"));
      expect(onTrigger).toHaveBeenCalledTimes(1);
    });

    test("nur rowClick-Aktion + onRowClick: weder Kebab noch Actions-Spalte, Zeilenklick feuert", async () => {
      const user = userEvent.setup();
      const onRowClick = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={onRowClick}
          rowActions={[{ id: "open", label: "Open", rowClick: true, onTrigger: mock() }]}
        />,
      );
      expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
      expect(screen.queryByTestId("column-actions")).toBeNull();
      expect(screen.queryByTestId("cell-r1-actions")).toBeNull();
      await user.click(screen.getByTestId("row-r1"));
      expect(onRowClick).toHaveBeenCalledTimes(1);
    });

    test("rowClick-Aktion + weitere Aktion + onRowClick: Kebab enthält nur die weitere", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={mock()}
          rowActions={[
            { id: "open", label: "Open", rowClick: true, onTrigger: mock() },
            { id: "archive", label: "Archive", onTrigger: mock() },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      expect(await screen.findByTestId("row-r1-action-archive")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-open")).toBeNull();
    });

    test("rowActionMode inline + onRowClick: rowClick-Aktion bleibt als Button", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={mock()}
          rowActionMode="inline"
          rowActions={[{ id: "open", label: "Open", rowClick: true, onTrigger: mock() }]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-open")).not.toBeNull();
    });

    test("rowClick-Aktion ohne onRowClick: bleibt sichtbar (Link-Button)", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[{ id: "open", label: "Open", rowClick: true, onTrigger: mock() }]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-open")).not.toBeNull();
    });

    test("rowClick-Aktion + onRowClick + onCellChange: Aktion bleibt im Kebab (kein Tastatur-Link in der Zelle)", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={mock()}
          onCellChange={mock()}
          rowActions={[
            { id: "open", label: "Open", rowClick: true, onTrigger: mock() },
            { id: "archive", label: "Archive", onTrigger: mock() },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      expect(await screen.findByTestId("row-r1-action-open")).not.toBeNull();
    });

    test("rowClick-Aktion + onRowClick, leere erste Zelle: sr-only-Link mit Aktions-Label öffnet die Zeile", async () => {
      const user = userEvent.setup();
      const onRowClick = mock();
      render(
        <DataTable
          columns={cols}
          rows={[{ id: "r1", values: { id: "r1", name: "" } }]}
          testId="dt"
          onRowClick={onRowClick}
          rowActions={[{ id: "open", label: "Open", rowClick: true, onTrigger: mock() }]}
        />,
      );
      const link = within(screen.getByTestId("cell-r1-name")).getByRole("button", { name: "Open" });
      await user.click(link);
      expect(onRowClick).toHaveBeenCalledTimes(1);
    });

    test("rowClick-Aktion per isVisible ausgeblendet: Zeilenklick tut nichts, kein Klick-Cursor", async () => {
      const user = userEvent.setup();
      const onRowClick = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={onRowClick}
          rowActions={[
            {
              id: "open",
              label: "Open",
              rowClick: true,
              isVisible: (row) => row.id === "r1",
              onTrigger: mock(),
            },
          ]}
        />,
      );
      expect(screen.getByTestId("row-r1").className).toContain("cursor-pointer");
      expect(screen.getByTestId("row-r2").className).not.toContain("cursor-pointer");
      await user.click(screen.getByTestId("row-r2"));
      expect(onRowClick).not.toHaveBeenCalled();
      await user.click(screen.getByTestId("row-r1"));
      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick.mock.calls[0]?.[0]).toMatchObject({ id: "r1" });
    });

    test(">2 Actions: primäre Aktion inline + Rest im Kebab-Dropdown", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "A", onTrigger: mock() },
            { id: "b", label: "B", onTrigger: mock() },
            { id: "c", label: "C", onTrigger: mock() },
          ]}
        />,
      );
      // "a" is the primary action (no id:"edit" declared, falls back to the
      // first visible action) — it renders as its own inline button.
      expect(screen.queryByTestId("row-r1-action-a")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
      // The rest sit behind the kebab — Radix portal'd content is only in
      // the DOM after the trigger is clicked.
      expect(screen.queryByTestId("row-r1-action-b")).toBeNull();
      expect(screen.queryByTestId("row-r1-action-c")).toBeNull();
    });

    test("4 Zeilen-Aktionen inkl. edit → Bearbeiten bleibt Text-Button, der Rest nur über den Kebab (bedienkonzept L3/L4)", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "duplicate", label: "Duplicate", onTrigger: mock() },
            { id: "edit", label: "Bearbeiten", onTrigger: mock() },
            { id: "archive", label: "Archive", onTrigger: mock() },
            { id: "delete", label: "Delete", style: "danger", onTrigger: mock() },
          ]}
        />,
      );
      expect(screen.getByTestId("row-r1-action-edit").textContent).toBe("Bearbeiten");
      expect(screen.queryByTestId("row-r1-action-duplicate")).toBeNull();
      expect(screen.queryByTestId("row-r1-action-archive")).toBeNull();
      expect(screen.queryByTestId("row-r1-action-delete")).toBeNull();
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      expect(screen.queryByTestId("row-r1-action-duplicate")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-archive")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-delete")).not.toBeNull();
    });

    test("rowActionMode='inline': IMMER Inline-Buttons, kein Kebab auch bei >2 (#9)", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActionMode="inline"
          rowActions={[
            { id: "a", label: "A", onTrigger: mock() },
            { id: "b", label: "B", onTrigger: mock() },
            { id: "c", label: "C", onTrigger: mock() },
          ]}
        />,
      );
      expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
      expect(screen.queryByTestId("row-r1-action-a")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-b")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-c")).not.toBeNull();
    });

    test("rowActionMode='inline': Buttons linksbündig + w-full (alignt über Rows, #8)", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActionMode="inline"
          rowActions={[{ id: "edit", label: "Edit", onTrigger: mock() }]}
        />,
      );
      const group = screen.getByTestId("row-r1-action-edit").parentElement;
      expect(group?.className).toContain("justify-start");
      expect(group?.className).toContain("w-full");
    });

    test("Kebab: Click auf Trigger öffnet Dropdown mit dem nicht-primären Rest", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: mock() },
            { id: "b", label: "Duplicate", onTrigger: mock() },
            { id: "c", label: "Export", onTrigger: mock() },
          ]}
        />,
      );
      // "a" is the primary action and already inline before the kebab opens.
      expect(screen.queryByTestId("row-r1-action-a")).not.toBeNull();
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      expect(screen.queryByTestId("row-r1-action-b")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-c")).not.toBeNull();
    });

    test("Kebab: Click auf Item ohne confirm → onTrigger feuert direkt", async () => {
      const user = userEvent.setup();
      const onTrigger = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: mock() },
            { id: "b", label: "Duplicate", onTrigger },
            { id: "c", label: "Export", onTrigger: mock() },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(screen.getByTestId("row-r1-action-b"));
      await waitFor(() => expect(onTrigger).toHaveBeenCalledWith(rows[0]));
    });

    test("Kebab: Click auf Danger-Item → Confirm-Dialog statt direkt-Trigger", async () => {
      const user = userEvent.setup();
      const onTrigger = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: mock() },
            { id: "b", label: "Duplicate", onTrigger: mock() },
            { id: "delete", label: "Delete", style: "danger", onTrigger },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(screen.getByTestId("row-r1-action-delete"));
      // Do NOT trigger directly: the dialog has to open first.
      expect(onTrigger).not.toHaveBeenCalled();
      expect(screen.queryByTestId("row-r1-action-delete-dialog")).not.toBeNull();
    });

    // Regression (solon e2e/cost-category.spec.ts, fw): unconditional
    // preventDefault() in onSelect blocked Radix' auto-close, so the
    // dropdown stayed in the DOM after the confirm flow (role="menu" +
    // body.style.pointerEvents="none" overlay lock never released), even
    // though the write itself had already succeeded.
    test("Kebab: nach Confirm+onTrigger ist das Dropdown-Menu geschlossen (kein Overlay-Lock)", async () => {
      const user = userEvent.setup();
      const onTrigger = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: mock() },
            { id: "b", label: "Duplicate", onTrigger: mock() },
            { id: "delete", label: "Delete", style: "danger", onTrigger },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(screen.getByTestId("row-r1-action-delete"));
      await user.click(screen.getByTestId("row-r1-action-delete-dialog-confirm"));
      await waitFor(() => expect(onTrigger).toHaveBeenCalledWith(rows[0]));
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(document.body.style.pointerEvents).not.toBe("none");
    });

    test("confirmLabel separat vom label: Dialog-Button zeigt confirmLabel", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            {
              id: "cancel-sub",
              label: "Mark Subscription as Cancelled",
              style: "danger",
              confirmLabel: "Cancel Subscription",
              confirm: "This is permanent.",
              onTrigger: mock(),
            },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-action-cancel-sub"));
      const dialog = screen.getByTestId("row-r1-action-cancel-sub-dialog");
      // The confirm button in the dialog has confirmLabel, not the full label
      const confirmBtn = dialog.querySelector('[data-testid$="confirm"]');
      expect(confirmBtn?.textContent).toContain("Cancel Subscription");
      expect(confirmBtn?.textContent).not.toContain("Mark Subscription");
    });

    test("Kebab-Pfad: Dialog-Button zeigt confirmLabel statt label", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: mock() },
            { id: "b", label: "Duplicate", onTrigger: mock() },
            {
              id: "cancel-sub",
              label: "Mark Subscription as Cancelled",
              style: "danger",
              confirmLabel: "Cancel Subscription",
              confirm: "This is permanent.",
              onTrigger: mock(),
            },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(screen.getByTestId("row-r1-action-cancel-sub"));
      const dialog = screen.getByTestId("row-r1-action-cancel-sub-dialog");
      const confirmBtn = dialog.querySelector('[data-testid$="confirm"]');
      expect(confirmBtn?.textContent).toContain("Cancel Subscription");
      expect(confirmBtn?.textContent).not.toContain("Mark Subscription");
    });

    test("Click auf Action ohne confirm: onTrigger wird mit Row gerufen", async () => {
      const user = userEvent.setup();
      const onTrigger = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[{ id: "edit", label: "Edit", onTrigger }]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-action-edit"));
      expect(onTrigger).toHaveBeenCalledWith(rows[0]);
    });

    test("style=danger: erzwingt Confirm-Dialog vor onTrigger", async () => {
      const onTrigger = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[{ id: "delete", label: "Delete", style: "danger", onTrigger }]}
        />,
      );
      fireEvent.click(screen.getByTestId("row-r1-action-delete"));
      // Click triggers the dialog, NOT onTrigger directly.
      expect(onTrigger).not.toHaveBeenCalled();
      // The dialog must be in the DOM; we check the testId suffix.
      expect(screen.queryByTestId("row-r1-action-delete-dialog")).not.toBeNull();
    });

    test("isVisible=false: Action erscheint nicht in der Cell", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            {
              id: "archive",
              label: "Archive",
              onTrigger: mock(),
              // Visible for r1 only
              isVisible: (row) => row.id === "r1",
            },
          ]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-archive")).not.toBeNull();
      expect(screen.queryByTestId("row-r2-action-archive")).toBeNull();
    });

    test("Click auf Action-Cell propagiert NICHT auf onRowClick", async () => {
      const user = userEvent.setup();
      const onRowClick = mock();
      const onTrigger = mock();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={onRowClick}
          rowActions={[{ id: "edit", label: "Edit", onTrigger }]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(await screen.findByTestId("row-r1-action-edit"));
      expect(onTrigger).toHaveBeenCalledTimes(1);
      // onTrigger fires, onRowClick MUST NOT, otherwise the user would navigate
      // to the edit screen at the same time on an action click.
      expect(onRowClick).not.toHaveBeenCalled();
    });

    // fw-ui-defaults: rowActionMode="inline" renders every action as an
    // always-visible button (no Kebab, unlike adaptive) — a group with more
    // than two icon-carrying actions collapses to icon-only so it doesn't
    // become a wall of text buttons.
    describe("icon-only collapse (mode='inline', >2 actions, all carry an icon)", () => {
      test("renders icon-only buttons with an accessible name per action", () => {
        render(
          <DataTable
            columns={cols}
            rows={rows}
            testId="dt"
            rowActionMode="inline"
            rowActions={[
              { id: "edit", label: "Edit", icon: "pencil", onTrigger: mock() },
              { id: "archive", label: "Archive", icon: "archive", onTrigger: mock() },
              { id: "delete", label: "Delete", icon: "trash", onTrigger: mock() },
            ]}
          />,
        );
        for (const [id, label] of [
          ["edit", "Edit"],
          ["archive", "Archive"],
          ["delete", "Delete"],
        ] as const) {
          expect(screen.getByTestId(`row-r1-action-${id}`).getAttribute("aria-label")).toBe(label);
        }
        const editButton = screen.getByTestId("row-r1-action-edit");
        // Icon-only: children (the label text) are gone, only the <svg> renders.
        expect(editButton.textContent).toBe("");
        expect(editButton.querySelector("svg")).not.toBeNull();
        expect(editButton.getAttribute("title")).toBe("Edit");
      });

      test("a group of exactly two icon actions keeps the text label (rule needs >2)", () => {
        render(
          <DataTable
            columns={cols}
            rows={rows}
            testId="dt"
            rowActionMode="inline"
            rowActions={[
              { id: "edit", label: "Edit", icon: "pencil", onTrigger: mock() },
              { id: "delete", label: "Delete", icon: "trash", onTrigger: mock() },
            ]}
          />,
        );
        expect(screen.getByTestId("row-r1-action-edit").textContent).toContain("Edit");
        expect(screen.getByTestId("row-r1-action-delete").textContent).toContain("Delete");
      });

      test("a mixed group (one action without an icon) keeps every label as text", () => {
        render(
          <DataTable
            columns={cols}
            rows={rows}
            testId="dt"
            rowActionMode="inline"
            rowActions={[
              { id: "edit", label: "Edit", icon: "pencil", onTrigger: mock() },
              { id: "archive", label: "Archive", icon: "archive", onTrigger: mock() },
              { id: "custom", label: "Custom", onTrigger: mock() },
            ]}
          />,
        );
        expect(screen.getByTestId("row-r1-action-edit").textContent).toContain("Edit");
        expect(screen.getByTestId("row-r1-action-archive").textContent).toContain("Archive");
        expect(screen.getByTestId("row-r1-action-custom").textContent).toContain("Custom");
      });
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
      expect(screen.getByTestId("own-row-r1")).not.toBeNull();
      expect(screen.getByTestId("own-cell-r1-name")).not.toBeNull();
      expect(screen.queryByTestId("row-r1")).toBeNull();
    });

    test("without overrides, defaults stay row-<id>/cell-<id>-<field>", () => {
      render(<DataTable columns={cols} rows={oneRow} />);
      expect(screen.getByTestId("row-r1")).not.toBeNull();
      expect(screen.getByTestId("cell-r1-name")).not.toBeNull();
    });
  });

  describe("onCellChange (editable cell)", () => {
    function EditableSwatch({ value, column, onChange }: ColumnRendererProps): ReactNode {
      return (
        <input
          data-testid={`edit-${column.field}`}
          value={String(value)}
          onChange={(e) => onChange?.(e.target.value)}
        />
      );
    }

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
          renderer: { format: "currency", symbol: "€" },
        },
      ] as const;
      render(
        <DataTable
          columns={cols}
          rows={[{ id: "r1", values: { amount: 42 } }]}
          onCellChange={onCellChange}
        />,
      );
      expect(screen.getByTestId("cell-r1-amount").textContent).toBe("42 €");
      expect(onCellChange).not.toHaveBeenCalled();
    });
  });
});

describe("DataTable toolbar slots", () => {
  test("toolbarStart + toolbarEnd rendern in einer Zeile; Titel wird NICHT gerendert (steht im Breadcrumb)", () => {
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

  test("ohne toolbar slots wird kein Toolbar-Container gerendert", () => {
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
