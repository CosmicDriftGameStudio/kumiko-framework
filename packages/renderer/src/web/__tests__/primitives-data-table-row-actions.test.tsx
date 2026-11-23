import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { DataTable } from "./_primitives-helpers.tsx";
import { fireEvent, render, screen, waitFor, within } from "./test-utils.tsx";

describe("DataTable", () => {
  // RowActions: pins the inline-vs-kebab decision, the confirm dialog
  // on style=danger, per-row visibility filter and onTrigger wiring.
  describe("RowActions", () => {
    const cols = [{ field: "name", label: "Name", type: "string", sortable: false }] as const;
    const rows = [
      { id: "r1", values: { id: "r1", name: "Alpha" } },
      { id: "r2", values: { id: "r2", name: "Beta" } },
    ];

    test("without rowActions: no actions column in the header", () => {
      render(<DataTable columns={cols} rows={rows} testId="dt" />);
      expect(screen.queryByTestId("column-actions")).toBeNull();
      expect(screen.queryByTestId("cell-r1-actions")).toBeNull();
    });

    test("with rowActions: actions column is rendered", () => {
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

    test("2 actions without onRowClick: primary inline, the other in the Kebab", () => {
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

    test("single action without onRowClick: link button, no Kebab", () => {
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

    test("with onRowClick: first cell is focusable, Enter opens it, actions only in the Kebab", async () => {
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

    test("only rowClick action + onRowClick: neither Kebab nor actions column, row click fires", async () => {
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

    test("rowClick action + additional action + onRowClick: Kebab contains only the additional action", async () => {
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
      await screen.findByTestId("row-r1-action-archive");
      expect(screen.queryByTestId("row-r1-action-open")).toBeNull();
    });

    test("rowActionMode inline + onRowClick: rowClick action remains a button", () => {
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

    test("rowClick action without onRowClick: remains visible (link button)", () => {
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

    test("rowClick action + onRowClick + onCellChange: action remains in the Kebab (no keyboard link in the cell)", async () => {
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
      await screen.findByTestId("row-r1-action-open");
    });

    test("rowClick action + onRowClick, empty first cell: sr-only link with action label opens the row", async () => {
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

    test("rowClick action hidden by isVisible: row click does nothing, no pointer cursor", async () => {
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

    test(">2 actions: primary action inline + remainder in the Kebab dropdown", () => {
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

    test("4 row actions including edit → Edit remains a text button, the rest only through the Kebab", async () => {
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

    test("rowActionMode='inline': always inline buttons, no Kebab even with >2", () => {
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

    test("rowActionMode='inline': buttons left-aligned + w-full (aligned across rows)", () => {
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

    test("Kebab: click on the trigger opens the dropdown with the non-primary rest", async () => {
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

    test("Kebab: click on an item without confirm → onTrigger fires directly", async () => {
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

    test("Kebab: click on a danger item → confirm dialog instead of direct trigger", async () => {
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
    test("Kebab: after confirm+onTrigger the dropdown menu is closed (no overlay lock)", async () => {
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

    test("confirmLabel separate from label: dialog button shows confirmLabel", async () => {
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

    test("confirm as a function: the dialog text comes from the clicked row", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            {
              id: "remove",
              label: "Remove",
              style: "danger",
              confirm: (row) => `Remove ${String(row.values["name"])}?`,
              onTrigger: mock(),
            },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r2-action-remove"));
      expect(screen.getByTestId("row-r2-action-remove-dialog").textContent).toContain(
        "Remove Beta?",
      );
    });

    test("Kebab path: confirm as a function names the clicked row", async () => {
      const user = userEvent.setup();
      render(
        <DataTable
          columns={cols}
          rows={rows}
          testId="dt"
          rowActions={[
            { id: "a", label: "Archive", onTrigger: mock() },
            {
              id: "remove",
              label: "Remove",
              style: "danger",
              confirm: (row) => `Remove ${String(row.values["name"])}?`,
              onTrigger: mock(),
            },
          ]}
        />,
      );
      await user.click(screen.getByTestId("row-r1-actions-menu"));
      await user.click(await screen.findByText("Remove"));
      expect(screen.getByTestId("row-r1-action-remove-dialog").textContent).toContain(
        "Remove Alpha?",
      );
    });

    test("Kebab path: dialog button shows confirmLabel instead of label", async () => {
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

    test("click on an action without confirm: onTrigger is called with the row", async () => {
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

    test("style=danger: forces a confirmation dialog before onTrigger", async () => {
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

    test("isVisible=false: action does not appear in the cell", () => {
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

    test("Clicking the action cell does NOT propagate to onRowClick", async () => {
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
});

describe("DataTable inMenu: false on the rowClick action", () => {
  const columns = [{ field: "name", label: "Name", type: "string", sortable: false }] as never;
  const rows = [{ id: "r1", values: { name: "A" } }] as never;
  const open = (extra: Record<string, unknown>) =>
    [{ id: "open", label: "Open", rowClick: true, onTrigger: () => {}, ...extra }] as never;

  test("menu mode lists the rowClick opener in a kebab, inMenu false leaves no kebab", () => {
    const { unmount } = render(
      <DataTable
        columns={columns}
        rows={rows}
        rowActionMode="menu"
        onRowClick={() => {}}
        rowActions={open({})}
      />,
    );
    expect(screen.queryByTestId("row-r1-actions-menu")).not.toBeNull();
    unmount();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowActionMode="menu"
        onRowClick={() => {}}
        rowActions={open({ inMenu: false })}
      />,
    );
    expect(screen.queryByTestId("row-r1-actions-menu")).toBeNull();
  });

  test("with onCellChange inMenu false is ignored: the kebab keeps the action", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        onRowClick={() => {}}
        onCellChange={mock()}
        rowActions={open({ inMenu: false })}
      />,
    );
    await user.click(screen.getByTestId("row-r1-actions-menu"));
    await screen.findByTestId("row-r1-action-open");
  });
});
