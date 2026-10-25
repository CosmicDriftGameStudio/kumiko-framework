import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { createStaticLocaleResolver, LocaleProvider } from "../../../index.ts";
import { defaultPrimitives } from "../index.tsx";

const { DataTable } = defaultPrimitives;

describe("DataTable format cells", () => {
  test("enumOption with tones draws the translated label as a toned pill", () => {
    const resolver = {
      ...createStaticLocaleResolver(),
      translate: (key: string) => (key === "s.failed" ? "Broken" : key),
    };
    render(
      <LocaleProvider resolver={resolver}>
        <DataTable
          columns={[
            {
              field: "status",
              label: "Status",
              type: "text",
              sortable: false,
              renderer: { format: "enumOption", keyPrefix: "s.", tones: { failed: "bad" } },
            },
          ]}
          rows={[{ id: "r1", values: { status: "failed" } }]}
          testId="t"
        />
      </LocaleProvider>,
    );

    const cell = screen.getByTestId("cell-r1-status");
    const pill = cell.querySelector("[data-status-dot]")?.parentElement;
    expect(pill?.className).toContain("text-status-bad");
    expect(cell.textContent).toBe("Broken");
  });

  test("enumOption with the accent tone draws a primary-colored pill", () => {
    render(
      <DataTable
        columns={[
          {
            field: "status",
            label: "Status",
            type: "text",
            sortable: false,
            renderer: { format: "enumOption", keyPrefix: "s.", tones: { running: "accent" } },
          },
        ]}
        rows={[{ id: "r1", values: { status: "running" } }]}
        testId="t"
      />,
    );

    const pill = screen
      .getByTestId("cell-r1-status")
      .querySelector("[data-status-dot]")?.parentElement;
    expect(pill?.className).toContain("text-primary");
  });

  test("a formatted cell with a link renders the text as a link", () => {
    render(
      <DataTable
        columns={[
          {
            field: "message",
            label: "Result",
            type: "text",
            sortable: false,
            renderer: { format: "i18nText" },
            linkFor: () => ({ href: "/fix", onPress: () => {} }),
          },
        ]}
        rows={[{ id: "r1", values: { message: "Login rejected" } }]}
        testId="t"
      />,
    );

    const link = screen.getByTestId("cell-r1-message").querySelector("a");
    expect(link?.getAttribute("href")).toBe("/fix");
    expect(link?.textContent).toBe("Login rejected");
  });
});
