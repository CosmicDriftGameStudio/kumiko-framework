import { describe, expect, test } from "bun:test";
import { DataTableCell } from "../primitives/data-table-cell.tsx";
import { render, screen } from "./test-utils.tsx";

describe("DataTableCell pillField", () => {
  test("draws the row's pill label beside the value, toned by pillToneField", () => {
    render(
      <DataTableCell
        value="Golf"
        row={{ vehicle: "Golf", state: "Free", stateTone: "positive" }}
        field="vehicle"
        type="string"
        pillField="state"
        pillToneField="stateTone"
      />,
    );
    expect(screen.getByText("Golf")).toBeTruthy();
    expect(screen.getByText("Free").className).toContain("bg-status-ok-surface");
  });

  test("an empty pill field leaves the plain cell", () => {
    render(
      <DataTableCell
        value="Golf"
        row={{ vehicle: "Golf", state: "" }}
        field="vehicle"
        type="string"
        pillField="state"
      />,
    );
    expect(screen.getByText("Golf")).toBeTruthy();
  });
});

describe("DataTableCell phone format", () => {
  test("renders the number as a tel: link with only digits and a leading plus", () => {
    render(
      <DataTableCell
        value="+49 (30) 123-45"
        row={{}}
        field="phone"
        type="string"
        renderer={{ format: "phone" }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("tel:+493012345");
    expect(link.textContent).toBe("+49 (30) 123-45");
  });
});
