import { describe, expect, test } from "bun:test";
import {
  PrimitivesProvider,
  type PrimitivesRegistry,
  type StatusBadgeProps,
} from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.js";

const { DataTable } = defaultPrimitives;

const columns = [
  {
    field: "state",
    label: "State",
    type: "select",
    sortable: false,
    optionLabels: { active: "Active" },
  },
] as const;
const rows = [{ id: "r1", values: { state: "active" } }];

function CustomStatusBadge({ value, tone }: StatusBadgeProps) {
  return (
    <span data-testid="custom-badge" data-tone={tone}>
      {value}
    </span>
  );
}

describe("DataTable select cell status badge", () => {
  test("uses the StatusBadge registered in the PrimitivesProvider", () => {
    const registry: PrimitivesRegistry = { ...defaultPrimitives, StatusBadge: CustomStatusBadge };
    render(
      <PrimitivesProvider value={registry}>
        <DataTable columns={columns} rows={rows} testId="t" />
      </PrimitivesProvider>,
    );

    const badge = screen.getByTestId("custom-badge");
    expect(badge.textContent).toBe("Active");
    expect(badge.getAttribute("data-tone")).toBe("ok");
  });

  test("falls back to the built-in pill without a provider", () => {
    render(<DataTable columns={columns} rows={rows} testId="t" />);

    expect(screen.queryByTestId("custom-badge")).toBeNull();
    expect(screen.getByTestId("cell-r1-state").textContent).toBe("Active");
  });
});
