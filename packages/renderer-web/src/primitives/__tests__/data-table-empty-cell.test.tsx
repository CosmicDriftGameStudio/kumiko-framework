import { describe, expect, test } from "bun:test";
import { createStaticLocaleResolver, LocaleProvider } from "@cosmicdrift/kumiko-renderer";
import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-types/kms-adapter-types";
import { render, screen } from "@testing-library/react";
import { defaultPrimitives } from "../index.js";

const { DataTable } = defaultPrimitives;

const columns = [{ field: "tenants", label: "Tenants", type: "text", sortable: false }] as const;

describe("DataTable renders a placeholder for empty cell values", () => {
  test.each([
    ["empty string", ""],
    ["whitespace-only string", "  "],
    ["null", null],
  ] as const)("%s shows the empty-cell placeholder instead of a blank cell", (_, value) => {
    render(
      <DataTable columns={columns} rows={[{ id: "r1", values: { tenants: value } }]} testId="t" />,
    );

    const cell = screen.getByTestId("cell-r1-tenants");
    expect(cell.textContent).toBe("–");
    expect(cell.querySelector('[data-empty-cell="true"]')).not.toBeNull();
  });

  test("a non-empty value is rendered as-is", () => {
    render(
      <DataTable
        columns={columns}
        rows={[{ id: "r1", values: { tenants: "Tenant Alpha, Tenant Beta" } }]}
        testId="t"
      />,
    );

    const cell = screen.getByTestId("cell-r1-tenants");
    expect(cell.textContent).toBe("Tenant Alpha, Tenant Beta");
    expect(cell.querySelector('[data-empty-cell="true"]')).toBeNull();
  });

  test("an erased PII value shows the translated erased label, not the sentinel", () => {
    render(
      <LocaleProvider resolver={createStaticLocaleResolver()}>
        <DataTable
          columns={columns}
          rows={[{ id: "r1", values: { tenants: PII_ERASED_SENTINEL } }]}
          testId="t"
        />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("cell-r1-tenants").textContent).toBe("kumiko.pii.erased");
  });
});
