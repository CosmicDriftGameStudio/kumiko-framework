// List cells with `display: "badge" | "button"` (projectionList tables) and the row tint under the
// sticky actions column.

import { describe, expect, test } from "bun:test";
import { EMPTY_VALUE_PLACEHOLDER } from "../../headless/index.ts";
import {
  cardToneClass,
  DataTableCell,
  LINK_BUTTON_CLASS,
  rowToneClass,
} from "../primitives/data-table-cell.tsx";
import { DataTable } from "./_primitives-helpers.tsx";
import { render, screen } from "./test-utils.tsx";

describe("DataTableCell display", () => {
  test("badge draws the value as a pill toned by the row's tone field", () => {
    render(
      <DataTableCell
        value="Failed"
        row={{ state: "Failed", stateTone: "negative" }}
        field="state"
        type="string"
        display="badge"
        badgeToneField="stateTone"
      />,
    );
    expect(screen.getByText("Failed").className).toContain("bg-status-bad-surface");
  });

  test("badge draws an empty value as the placeholder, not as an empty pill", () => {
    render(<DataTableCell value={null} row={{}} field="state" type="string" display="badge" />);
    expect(screen.getByText(EMPTY_VALUE_PLACEHOLDER).className).not.toContain("bg-status-");
  });

  test("badge and button with a column renderer and an empty value draw the placeholder, not a pill", () => {
    for (const display of ["badge", "button"] as const) {
      const { unmount } = render(
        <DataTableCell
          value=""
          row={{}}
          field="state"
          type="string"
          renderer={() => null}
          display={display}
          link={{ href: "/x", onPress: () => {} }}
        />,
      );
      expect(screen.getByText(EMPTY_VALUE_PLACEHOLDER).className).not.toContain("bg-status-");
      expect(screen.queryByRole("link")).toBeNull();
      unmount();
    }
  });

  test("badge of a select field shows the option label, not the raw value", () => {
    render(
      <DataTableCell
        value="open"
        row={{}}
        field="state"
        type="select"
        optionLabels={{ open: "Open now" }}
        display="badge"
      />,
    );
    expect(screen.getByText("Open now")).toBeTruthy();
    expect(screen.queryByText("open")).toBeNull();
  });

  test("badge of a column with a lookup renderer or FormatSpec shows the rendered text, not the raw value", () => {
    const { unmount } = render(
      <DataTableCell
        value="uuid-1"
        row={{}}
        field="owner"
        type="string"
        renderer={(value: unknown) => (value === "uuid-1" ? "Ada Lovelace" : "?")}
        display="badge"
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.queryByText("uuid-1")).toBeNull();
    unmount();
    render(
      <DataTableCell
        value="2026-03-04"
        row={{}}
        field="due"
        type="string"
        renderer={{ format: "date", locale: "en-US", dateStyle: "long" }}
        display="badge"
      />,
    );
    expect(screen.getByText("March 4, 2026")).toBeTruthy();
  });

  test("button draws a linked value as an outline button, not as a text link", () => {
    render(
      <DataTableCell
        value="Open order"
        row={{}}
        field="action"
        type="string"
        display="button"
        link={{ href: "/order-detail/o1", onPress: () => {} }}
      />,
    );
    const link = screen.getByRole("link", { name: "Open order" });
    for (const token of LINK_BUTTON_CLASS.split(" ")) expect(link.className).toContain(token);
    expect(link.className).not.toContain("hover:underline");
  });

  test("button without a link stays plain text", () => {
    render(
      <DataTableCell value="Open order" row={{}} field="action" type="string" display="button" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Open order")).toBeTruthy();
  });
});

describe("DataTable row tone", () => {
  const columns = [{ field: "name", label: "Name", type: "string" as const, sortable: false }];
  const rows = [{ id: "r1", values: { name: "Ada" } }];
  const rowActions = [{ id: "archive", label: "Archive", onTrigger: () => {} }];

  test("a toned row draws a left stripe on its first cell and no background tint", () => {
    const { container } = render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowTone={() => "bad"}
        rowActions={rowActions}
      />,
    );
    const row = container.querySelector('tr[data-tone="bad"]');
    expect(row?.className).toContain("inset_4px_0_0_var(--row-stripe)");
    expect(row?.className).toContain("[--row-stripe:var(--color-status-bad)]");
    expect(row?.className).not.toContain("bg-status-bad");
  });

  test("the sticky actions cell stays an opaque surface under a toned row", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowTone={() => "bad"}
        rowActions={rowActions}
      />,
    );
    const cell = screen.getByTestId("cell-r1-actions");
    expect(cell.className).toContain("md:bg-background");
    expect(cell.className).not.toContain("color-mix");
  });

  test("a neutral tone draws no table stripe, a neutral card a grey one", () => {
    expect(rowToneClass("neutral")).toBe("");
    expect(cardToneClass("neutral")).toContain("before:bg-border-strong");
    expect(rowToneClass(undefined)).toBe("");
  });

  test("cards use a real left border in the tone color", () => {
    expect(cardToneClass("warn")).toContain("before:w-1");
    expect(cardToneClass("warn")).toContain("before:bg-status-warn");
  });
});
