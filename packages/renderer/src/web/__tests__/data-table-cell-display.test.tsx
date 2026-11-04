// List cells with `display: "badge" | "button"` (projectionList tables) and the row tint under the
// sticky actions column.

import { describe, expect, test } from "bun:test";
import { EMPTY_VALUE_PLACEHOLDER } from "../../headless/index.ts";
import { DataTableCell, LINK_BUTTON_CLASS, rowToneClass } from "../primitives/data-table-cell.tsx";
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
    expect(screen.getByText(EMPTY_VALUE_PLACEHOLDER)).toBeTruthy();
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

describe("DataTable actions cell under a toned row", () => {
  const columns = [{ field: "name", label: "Name", type: "string" as const, sortable: false }];
  const rows = [{ id: "r1", values: { name: "Ada" } }];
  const rowActions = [{ id: "archive", label: "Archive", onTrigger: () => {} }];

  test("mixes the row's tint into an opaque surface instead of the page background", () => {
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
    expect(cell.className).toContain(
      "color-mix(in_srgb,var(--row-tone)_10%,var(--color-background))",
    );
    expect(cell.style.getPropertyValue("--row-tone")).toBe("var(--color-status-bad)");
    expect(cell.className).not.toContain(rowToneClass("bad").split(" ")[0] ?? "");
    expect(cell.className).not.toContain("md:bg-background");
  });

  test("a neutral tone keeps the opaque background without a tint variable", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        testId="t"
        rowTone={() => "neutral"}
        rowActions={rowActions}
      />,
    );
    const cell = screen.getByTestId("cell-r1-actions");
    expect(cell.className).toContain("md:bg-background");
    expect(cell.style.getPropertyValue("--row-tone")).toBe("");
  });

  test("an untoned row keeps the opaque background", () => {
    render(<DataTable columns={columns} rows={rows} testId="t" rowActions={rowActions} />);
    expect(screen.getByTestId("cell-r1-actions").className).toContain("md:bg-background");
  });
});
