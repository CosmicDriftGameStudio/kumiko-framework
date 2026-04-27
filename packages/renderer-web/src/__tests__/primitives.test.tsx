// @vitest-environment jsdom
//
// Default-Primitives für Web-Renderer. Tests pinnen den Vertrag, den die
// Renderer-Komponenten (RenderEdit, RenderList, KumikoScreen) an die
// Primitives weiterreichen — vor allem Accessibility-Zusagen
// (role="alert" bei Error-Varianten), Event-Shape-Mapping (Input
// liefert pro kind unterschiedliche JS-Typen zurück statt des rohen
// ChangeEvent) und das testId-Forwarding, von dem die E2E-Tests
// abhängen werden.

import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { defaultPrimitives } from "../primitives";
import { fireEvent, render, screen } from "./test-utils";

const { Button, Banner, Field, Input, DataTable, Form, Text, Heading, Dialog } = defaultPrimitives;

describe("Button", () => {
  test("disabled: attribute gesetzt + Tailwind-Klassen für pointer-events/opacity", () => {
    render(
      <Button disabled testId="btn">
        Save
      </Button>,
    );
    const btn = screen.getByTestId("btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Visuelles Feedback kommt aus Tailwind-Klassen (shadcn-Pattern).
    expect(btn.className).toContain("disabled:pointer-events-none");
    expect(btn.className).toContain("disabled:opacity-50");
  });

  test("onClick fires on click", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} testId="btn">
        Go
      </Button>,
    );
    fireEvent.click(screen.getByTestId("btn"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("loading: rendert Spinner statt Children + ist disabled", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} testId="btn">
        Save
      </Button>,
    );
    const btn = screen.getByTestId("btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset["loading"]).toBe("true");
    // Children verschwinden während loading; Spinner ist ein <svg>.
    expect(btn.textContent).not.toContain("Save");
    expect(btn.querySelector("svg")).not.toBeNull();
  });
});

describe("Banner", () => {
  test('variant="error" sets role="alert" (a11y)', () => {
    render(
      <Banner variant="error" testId="b">
        Something broke
      </Banner>,
    );
    expect(screen.getByTestId("b").getAttribute("role")).toBe("alert");
  });

  test('variant="info" has no alert role', () => {
    render(
      <Banner variant="info" testId="b">
        Hi
      </Banner>,
    );
    expect(screen.getByTestId("b").getAttribute("role")).toBeNull();
  });

  test("actions prop renders in actions slot", () => {
    render(
      <Banner variant="info" testId="b" actions={<span>undo</span>}>
        Saved
      </Banner>,
    );
    const slot = screen.getByTestId("b").querySelector('[data-slot="actions"]');
    expect(slot?.textContent).toBe("undo");
  });
});

describe("Field", () => {
  test("required fügt einen Stern ans Label an", () => {
    render(
      <Field id="f1" label="Name" required testId="f">
        <input />
      </Field>,
    );
    // shadcn-Field rendert den Mark als <span>* mit text-destructive.
    const label = screen.getByTestId("f").querySelector("label");
    expect(label?.textContent).toContain("*");
  });

  test("issues render inside role=alert with per-testId suffix", () => {
    render(
      <Field
        id="f1"
        label="Email"
        testId="f"
        issues={[{ path: "email", code: "invalid", i18nKey: "Email invalid" }]}
      >
        <input />
      </Field>,
    );
    const alert = screen.getByTestId("f-errors");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Email invalid");
  });

  test("no issues → no alert element", () => {
    render(
      <Field id="f1" label="Email" testId="f">
        <input />
      </Field>,
    );
    expect(screen.queryByTestId("f-errors")).toBeNull();
  });
});

describe("Input kind mapping", () => {
  test('kind="text": onChange receives string', () => {
    const onChange = vi.fn();
    render(<Input id="i" name="i" kind="text" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  test('kind="number": "" → undefined, numeric → number', () => {
    const onChange = vi.fn();
    render(<Input id="i" name="i" kind="number" value={0} onChange={onChange} />);
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(42);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  test('kind="boolean": onChange receives checked', () => {
    const onChange = vi.fn();
    render(<Input id="i" name="i" kind="boolean" value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('kind="date": Trigger zeigt formatiertes Datum, kein nativer date-Input', () => {
    // Default-DateInput nutzt Radix-Popover + DayPicker statt native
    // <input type="date">. Trigger ist ein Button mit dem formatierten
    // Datum als sichtbarem Text.
    const onChange = vi.fn();
    render(
      <Input id="i" name="i" kind="date" value="2026-04-23" onChange={onChange} locale="de-DE" />,
    );
    expect(document.querySelector('input[type="date"]')).toBeNull();
    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toContain("23. April 2026");
  });

  test("hasError=true sets aria-invalid", () => {
    render(<Input id="i" name="i" kind="text" value="" hasError onChange={() => {}} />);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("DataTable", () => {
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
    expect(screen.getByTestId("cell-r1-active").textContent).toBe("✓");
  });

  test("onRowClick fires with the clicked row", () => {
    const onRowClick = vi.fn();
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

  // Sort-Header pinnt das 3-State-Toggle-Verhalten + Visual-Indicator
  // + aria-sort. Renderer-Vertrag mit dem Caller (RenderList): jede
  // sortable-Column liefert beim Click den nächsten Sort-State zurück
  // — Caller setzt damit URL-State und re-fetcht.
  describe("Sort-Header", () => {
    const sortableCols = [
      { field: "name", label: "Name", type: "string", sortable: true },
      { field: "createdAt", label: "Created", type: "timestamp", sortable: true },
      { field: "id", label: "ID", type: "string", sortable: false },
    ] as const;
    // Mindestens eine Row, sonst rendert der DefaultDataTable den
    // Empty-State-Branch und das thead-Markup ist gar nicht im DOM.
    // Sort-Header lebt im thead, das brauchen wir hier.
    const oneRow = [{ id: "r1", values: { name: "A", createdAt: "2026-01-01", id: "r1" } }];

    test("ohne onSortChange: Header bleibt plain (kein Button, kein cursor)", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} />);
      // Plain th.textContent enthält das Label. KEIN Button drinnen.
      expect(screen.getByTestId("column-name").querySelector("button")).toBeNull();
    });

    test("mit onSortChange: sortable-Column rendert Button + ArrowUpDown-Icon", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={vi.fn()} />);
      const header = screen.getByTestId("column-name");
      expect(header.querySelector("button")).not.toBeNull();
      // Default-Icon (kein active sort) ist ArrowUpDown — Lucide rendert
      // svg ohne expliziten name; wir prüfen aria-sort='none'.
      expect(header.getAttribute("aria-sort")).toBe("none");
    });

    test("non-sortable Column rendert KEINEN Button (auch mit onSortChange)", () => {
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={vi.fn()} />);
      expect(screen.getByTestId("column-id").querySelector("button")).toBeNull();
    });

    test("aria-sort=ascending wenn sort.field passt + dir=asc", () => {
      render(
        <DataTable
          columns={sortableCols}
          rows={oneRow}
          sort={{ field: "name", dir: "asc" }}
          onSortChange={vi.fn()}
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
          onSortChange={vi.fn()}
        />,
      );
      expect(screen.getByTestId("column-name").getAttribute("aria-sort")).toBe("descending");
    });

    test("Click ohne aktiven Sort: onSortChange({field, dir:'asc'})", () => {
      const onSortChange = vi.fn();
      render(<DataTable columns={sortableCols} rows={oneRow} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTestId("column-name").querySelector("button") as HTMLElement);
      expect(onSortChange).toHaveBeenCalledWith({ field: "name", dir: "asc" });
    });

    test("Click mit aktivem asc: onSortChange({field, dir:'desc'})", () => {
      const onSortChange = vi.fn();
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
      const onSortChange = vi.fn();
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
      const onSortChange = vi.fn();
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
      // Andere Spalte: dort gibt's keinen aktiven Sort, also asc.
      expect(onSortChange).toHaveBeenCalledWith({ field: "createdAt", dir: "asc" });
    });
  });

  // Pager: Window-of-7 Logik + 3 State-Pfade (first/middle/last page),
  // disabled-Edges, Click-Callback. Server-Wiring (offset etc.) liegt
  // im KumikoScreen — hier nur das UI.
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
          pager={{ page: 1, limit: 50, total: 0, onPageChange: vi.fn() }}
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
          pager={{ page: 1, limit: 50, total: 3000, onPageChange: vi.fn() }}
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
          pager={{ page: 60, limit: 50, total: 3000, onPageChange: vi.fn() }}
        />,
      );
      expect((screen.getByTestId("dt-pager-next") as HTMLButtonElement).disabled).toBe(true);
    });

    test("Click auf Page-Button: onPageChange feuert mit der Seite", () => {
      const onPageChange = vi.fn();
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 3000, onPageChange }}
        />,
      );
      fireEvent.click(screen.getByTestId("dt-pager-page-2"));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    test("Click auf Prev von page=3: onPageChange(2)", () => {
      const onPageChange = vi.fn();
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

    test("aria-current='page' auf der aktiven Seite", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 5, limit: 50, total: 3000, onPageChange: vi.fn() }}
        />,
      );
      expect(screen.getByTestId("dt-pager-page-5").getAttribute("aria-current")).toBe("page");
    });

    test("totalPages ≤ 7: alle Seiten ohne Ellipse", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 1, limit: 50, total: 200, onPageChange: vi.fn() }}
        />,
      );
      // total=200, limit=50 → 4 Seiten, kein Window
      expect(screen.queryByTestId("dt-pager-page-1")).not.toBeNull();
      expect(screen.queryByTestId("dt-pager-page-4")).not.toBeNull();
      // Kein Ellipsis-Glyph im DOM
      expect(screen.queryByText("…")).toBeNull();
    });

    test("totalPages > 7 und page in der Mitte: Ellipsen außen", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          pager={{ page: 30, limit: 50, total: 3000, onPageChange: vi.fn() }}
        />,
      );
      // Window: 1 ... 28 29 [30] 31 32 ... 60
      expect(screen.getAllByText("…")).toHaveLength(2);
      expect(screen.queryByTestId("dt-pager-page-1")).not.toBeNull();
      expect(screen.queryByTestId("dt-pager-page-60")).not.toBeNull();
      expect(screen.queryByTestId("dt-pager-page-30")).not.toBeNull();
    });
  });

  // Infinite-Scroll Sentinel: rendert sentinel-div, zeigt Spinner wenn
  // loadingMore, "End of list" wenn !hasMore. IntersectionObserver
  // selbst ist in jsdom unmocked — wir testen nur die Marker, der
  // Observer-Fire-Pfad ist im KumikoScreen.EntityListBody.
  describe("InfiniteSentinel", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const oneRow = [{ id: "r1", values: { name: "A" } }];

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
          onReachEnd={vi.fn()}
          loadingMore={false}
          hasMore={true}
        />,
      );
      const sentinel = screen.getByTestId("dt-sentinel");
      // Weder End-Marker noch Spinner — der Sentinel wartet auf den
      // Observer-Fire (Pre-Fetch via rootMargin: 200px).
      expect(sentinel.querySelector("svg")).toBeNull();
      expect(screen.queryByTestId("dt-sentinel-end")).toBeNull();
    });

    test("loadingMore=true: Spinner sichtbar", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          onReachEnd={vi.fn()}
          loadingMore={true}
          hasMore={true}
        />,
      );
      expect(screen.getByTestId("dt-sentinel").querySelector("svg")).not.toBeNull();
    });

    test("hasMore=false: 'End of list' Marker statt Sentinel-Wirkung", () => {
      render(
        <DataTable
          columns={cols}
          rows={oneRow}
          testId="dt"
          onReachEnd={vi.fn()}
          loadingMore={false}
          hasMore={false}
        />,
      );
      expect(screen.getByTestId("dt-sentinel-end")).not.toBeNull();
      expect(screen.getByTestId("dt-sentinel-end").textContent).toContain("End of list");
    });
  });

  // RowActions: pinst die Inline-vs-Kebab-Entscheidung, Confirm-Dialog
  // bei style=danger, Visibility-Filter pro Row und onTrigger-Wiring.
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
          rowActions={[{ id: "edit", label: "Edit", onTrigger: vi.fn() }]}
        />,
      );
      expect(screen.queryByTestId("column-actions")).not.toBeNull();
      expect(screen.queryByTestId("cell-r1-actions")).not.toBeNull();
    });

    test("≤2 Actions: Inline-Buttons (kein Kebab)", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "edit", label: "Edit", onTrigger: vi.fn() },
            { id: "delete", label: "Delete", style: "danger", onTrigger: vi.fn() },
          ]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-edit")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
    });

    test(">2 Actions: Kebab-Dropdown statt Inline-Buttons", () => {
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "A", onTrigger: vi.fn() },
            { id: "b", label: "B", onTrigger: vi.fn() },
            { id: "c", label: "C", onTrigger: vi.fn() },
          ]}
        />,
      );
      expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
      // Inline-Buttons der Kebab-Items sind nicht direkt im DOM —
      // Radix portal'd Content ist erst nach Click sichtbar.
      expect(screen.queryByTestId("row-r1-action-a")).toBeNull();
    });

    test("Kebab: Click auf Trigger öffnet Dropdown mit allen Items", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: vi.fn() },
            { id: "b", label: "Duplicate", onTrigger: vi.fn() },
            { id: "c", label: "Export", onTrigger: vi.fn() },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      expect(screen.queryByTestId("row-r1-action-a")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-b")).not.toBeNull();
      expect(screen.queryByTestId("row-r1-action-c")).not.toBeNull();
    });

    test("Kebab: Click auf Item ohne confirm → onTrigger feuert direkt", async () => {
      const user = userEvent.setup();
      const onTrigger = vi.fn();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger },
            { id: "b", label: "Duplicate", onTrigger: vi.fn() },
            { id: "c", label: "Export", onTrigger: vi.fn() },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(screen.getByTestId("row-r1-action-a"));
      // micro-task warten (onTrigger ist async im Hook)
      await new Promise((r) => setTimeout(r, 0));
      expect(onTrigger).toHaveBeenCalledWith(rows[0]);
    });

    test("Kebab: Click auf Danger-Item → Confirm-Dialog statt direkt-Trigger", async () => {
      const user = userEvent.setup();
      const onTrigger = vi.fn();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: vi.fn() },
            { id: "b", label: "Duplicate", onTrigger: vi.fn() },
            { id: "delete", label: "Delete", style: "danger", onTrigger },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(screen.getByTestId("row-r1-action-delete"));
      // Trigger NICHT direkt — der Dialog muss zuerst öffnen.
      expect(onTrigger).not.toHaveBeenCalled();
      expect(screen.queryByTestId("row-r1-action-delete-dialog")).not.toBeNull();
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
              onTrigger: vi.fn(),
            },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-action-cancel-sub"));
      const dialog = screen.getByTestId("row-r1-action-cancel-sub-dialog");
      // Confirm-Button im Dialog hat confirmLabel, nicht das volle label
      const confirmBtn = dialog.querySelector('[data-testid$="confirm"]');
      expect(confirmBtn?.textContent).toContain("Cancel Subscription");
      expect(confirmBtn?.textContent).not.toContain("Mark Subscription");
    });

    test("Click auf Action ohne confirm: onTrigger wird mit Row gerufen", async () => {
      const onTrigger = vi.fn();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[{ id: "edit", label: "Edit", onTrigger }]}
        />,
      );
      fireEvent.click(screen.getByTestId("row-r1-action-edit"));
      // onTrigger ist async (await im Component) — micro-task warten.
      await new Promise((r) => setTimeout(r, 0));
      expect(onTrigger).toHaveBeenCalledWith(rows[0]);
    });

    test("style=danger: erzwingt Confirm-Dialog vor onTrigger", async () => {
      const onTrigger = vi.fn();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[{ id: "delete", label: "Delete", style: "danger", onTrigger }]}
        />,
      );
      fireEvent.click(screen.getByTestId("row-r1-action-delete"));
      // Click triggered den Dialog, NICHT direkt onTrigger.
      expect(onTrigger).not.toHaveBeenCalled();
      // Dialog muss im DOM sein — wir checken den testId-Suffix.
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
              onTrigger: vi.fn(),
              // Nur für r1 sichtbar
              isVisible: (row) => row.id === "r1",
            },
          ]}
        />,
      );
      expect(screen.queryByTestId("row-r1-action-archive")).not.toBeNull();
      expect(screen.queryByTestId("row-r2-action-archive")).toBeNull();
    });

    test("Click auf Action-Cell propagiert NICHT auf onRowClick", () => {
      const onRowClick = vi.fn();
      const onTrigger = vi.fn();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          onRowClick={onRowClick}
          rowActions={[{ id: "edit", label: "Edit", onTrigger }]}
        />,
      );
      fireEvent.click(screen.getByTestId("row-r1-action-edit"));
      // onTrigger feuert, onRowClick MUSS NICHT — sonst würde der User
      // beim Action-Click gleichzeitig zum Edit-Screen navigieren.
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });
});

describe("Form", () => {
  test("submit calls onSubmit and prevents default navigation", () => {
    const onSubmit = vi.fn();
    render(
      <Form onSubmit={onSubmit} testId="form">
        <button type="submit">Go</button>
      </Form>,
    );
    const form = screen.getByTestId("form") as HTMLFormElement;
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(form, submitEvent);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitEvent.defaultPrevented).toBe(true);
  });

  test("title slot rendert in der Action-Bar links neben den Actions", () => {
    render(
      <Form
        onSubmit={() => undefined}
        title="Eintrag bearbeiten"
        actions={<button type="submit">Save</button>}
        testId="form"
      >
        <div>content</div>
      </Form>,
    );
    const actionsBar = screen.getByTestId("form-actions");
    expect(actionsBar.textContent).toContain("Eintrag bearbeiten");
    expect(actionsBar.textContent).toContain("Save");
  });

  test("ohne title und actions: keine Action-Bar gerendert", () => {
    render(
      <Form onSubmit={() => undefined} testId="form">
        <div>content</div>
      </Form>,
    );
    expect(screen.queryByTestId("form-actions")).toBeNull();
  });
});

describe("Banner padded", () => {
  test("padded=true wraps in p-6 container für Page-State-Use", () => {
    const { container } = render(
      <Banner padded variant="info" testId="banner">
        Loading…
      </Banner>,
    );
    const banner = screen.getByTestId("banner");
    // Outer wrapper hat p-6, banner innen
    const wrapper = banner.parentElement;
    expect(wrapper?.className).toContain("p-6");
    expect(container.firstChild).toBe(wrapper);
  });

  test("padded=undefined rendert ohne Wrapper (inline-Use)", () => {
    const { container } = render(
      <Banner variant="info" testId="banner">
        Inline
      </Banner>,
    );
    expect(container.firstChild).toBe(screen.getByTestId("banner"));
  });
});

describe("Heading variants", () => {
  test('variant="page" renders h1', () => {
    render(
      <Heading variant="page" testId="h">
        Items
      </Heading>,
    );
    expect(screen.getByTestId("h").tagName).toBe("H1");
  });

  test('variant="section" renders h2 mit uppercase styling', () => {
    render(
      <Heading variant="section" testId="h">
        Basics
      </Heading>,
    );
    const h = screen.getByTestId("h");
    expect(h.tagName).toBe("H2");
    expect(h.className).toContain("uppercase");
  });
});

describe("DataTable toolbar slots", () => {
  test("toolbarTitle + toolbarStart + toolbarEnd rendern in einer Zeile", () => {
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
    expect(toolbar.textContent).toContain("Items");
    expect(toolbar.querySelector('[data-testid="search"]')).not.toBeNull();
    expect(toolbar.querySelector('[data-testid="create"]')).not.toBeNull();
  });

  test("ohne toolbar slots wird kein Toolbar-Container gerendert", () => {
    render(<DataTable columns={[]} rows={[]} testId="dt" />);
    expect(screen.queryByTestId("dt-toolbar")).toBeNull();
  });
});

describe("Dialog", () => {
  test("open=true rendert Dialog mit Title und Confirm/Cancel Buttons", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Wirklich löschen?"
        onConfirm={onConfirm}
        testId="confirm"
      />,
    );
    expect(screen.getByText("Wirklich löschen?")).toBeTruthy();
    expect(screen.getByTestId("confirm-confirm")).toBeTruthy();
    expect(screen.getByTestId("confirm-cancel")).toBeTruthy();
  });

  test("open=false rendert nichts (Portal leer)", () => {
    render(
      <Dialog
        open={false}
        onOpenChange={() => undefined}
        title="Hidden"
        onConfirm={() => undefined}
        testId="hidden-dialog"
      />,
    );
    expect(screen.queryByTestId("hidden-dialog")).toBeNull();
  });

  test("Confirm-Button feuert onConfirm und schließt den Dialog", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Bestätigen?"
        onConfirm={onConfirm}
        testId="dlg"
      />,
    );
    // userEvent.click wartet auf React-State-Updates die durch Radix-
    // Lifecycle (Presence/FocusScope/DismissableLayer) ausgelöst werden
    // — fireEvent.click würde dieselben Updates uneingewickelt lassen
    // und mit ~13 act()-Warnings spammen.
    await user.click(screen.getByTestId("dlg-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("Text variants", () => {
  test('variant="code" renders <code>', () => {
    render(
      <Text variant="code" testId="t">
        x
      </Text>,
    );
    expect(screen.getByTestId("t").tagName).toBe("CODE");
  });

  test('variant="small" renders <small>', () => {
    render(
      <Text variant="small" testId="t">
        x
      </Text>,
    );
    expect(screen.getByTestId("t").tagName).toBe("SMALL");
  });

  test('variant="required-mark" renders data-required span', () => {
    render(
      <Text variant="required-mark" testId="t">
        *
      </Text>,
    );
    const el = screen.getByTestId("t");
    expect(el.tagName).toBe("SPAN");
    expect(el.hasAttribute("data-required")).toBe(true);
  });
});
