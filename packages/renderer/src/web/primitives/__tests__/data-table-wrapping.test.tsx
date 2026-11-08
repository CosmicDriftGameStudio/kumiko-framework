import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "../../../index.ts";
import { defaultPrimitives } from "../index.tsx";

const { DataTable } = defaultPrimitives;

const columns = [
  { field: "title", label: "Angepasst von", type: "string", sortable: false },
  { field: "note", label: "Anmerkung", type: "string", sortable: true },
] as const;

const rows = [
  { id: "r1", values: { title: "Nordlicht Immobilien GmbH", note: "0 von 5 Mandanten" } },
];

describe("DataTable keeps cells on one line and truncates, headers wrap", () => {
  test("headers (plain and sortable) wrap, text cells truncate, row actions stay on one line", () => {
    render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en" })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DataTable
          columns={columns}
          rows={rows}
          testId="t"
          onSortChange={() => {}}
          rowActions={[{ id: "edit", label: "Bearbeiten", onTrigger: () => {} }]}
        />
      </LocaleProvider>,
    );

    for (const id of ["column-title", "column-note"]) {
      const cls = screen.getByTestId(id).className.split(/\s+/);
      expect(cls).toContain("whitespace-normal");
      expect(cls).not.toContain("truncate");
    }
    for (const id of ["cell-r1-title", "cell-r1-note"]) {
      const cls = screen.getByTestId(id).className.split(/\s+/);
      expect(cls).toContain("truncate");
      expect(cls).not.toContain("whitespace-normal");
    }
    expect(screen.getByTestId("cell-r1-actions").className.split(/\s+/)).toContain(
      "whitespace-nowrap",
    );
  });
});
