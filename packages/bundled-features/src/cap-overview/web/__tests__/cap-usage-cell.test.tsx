import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CapUsageCell } from "../cap-usage-cell.js";

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <LocaleProvider resolver={createStaticLocaleResolver()}>
      <PrimitivesProvider value={defaultPrimitives}>{children}</PrimitivesProvider>
    </LocaleProvider>
  );
}

function renderCell(value: unknown): void {
  render(
    <Wrapper>
      <CapUsageCell value={value} row={{}} column={{ field: "cap__apiCalls" }} />
    </Wrapper>,
  );
}

describe("CapUsageCell", () => {
  test("renders the unlimited label for a cap with limit null", () => {
    renderCell({ used: 165, limit: null, fraction: 0 });

    expect(screen.getByTestId("cap-usage-unlimited").textContent).toBe("cap-overview.unlimited");
  });

  test("renders the not-measured text for used null with a finite limit", () => {
    renderCell({ used: null, limit: 100, fraction: 0 });

    expect(screen.getByTestId("cap-usage-not-measured")).toBeTruthy();
  });

  test("renders a bar for a regular used/limit value", () => {
    renderCell({ used: 40, limit: 100, fraction: 0.4 });

    expect(screen.getByTestId("cap-usage-bar")).toBeTruthy();
  });

  test.each([
    ["a non-object", 42],
    ["null", null],
    ["a value with a non-number limit", { used: 1, limit: "100", fraction: 0 }],
    ["a value without fraction", { used: 1, limit: 100 }],
  ])("renders nothing for %s", (_label, value) => {
    renderCell(value);

    expect(screen.queryByTestId("cap-usage-bar")).toBeNull();
    expect(screen.queryByTestId("cap-usage-unlimited")).toBeNull();
    expect(screen.queryByTestId("cap-usage-not-measured")).toBeNull();
  });
});
