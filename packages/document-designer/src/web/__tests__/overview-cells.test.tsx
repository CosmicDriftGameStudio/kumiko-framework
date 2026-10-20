import { describe, expect, test } from "bun:test";
import { textBlocksClient } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
  mergeTranslations,
} from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StatusCell, TitleCell } from "../cells.tsx";
import { documentDesignerClient } from "../client-plugin.tsx";

const translations = mergeTranslations(
  mergeTranslations(kumikoDefaultTranslations, textBlocksClient().translations ?? {}),
  mergeTranslations(documentDesignerClient().translations ?? {}, {
    en: { "moneyHorse:template.creditSchedule.title": "Credit repayment schedule" },
  }),
);

function renderCell(cell: (props: never) => ReactNode, row: Record<string, unknown>): void {
  const Cell = cell as (props: { row: Record<string, unknown> }) => ReactNode;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "en" })}
      fallbackBundles={[translations]}
    >
      <Cell row={row} />
    </LocaleProvider>,
  );
}

const baseRow = {
  id: "document-pdf|money-horse:credit-schedule",
  slug: "money-horse:credit-schedule",
  kind: "document-pdf",
  origin: "system",
  locales: ["de"],
  status: "active",
  version: 3,
  modifiedAt: "2026-10-01T08:00:00Z",
};

describe("template overview cells", () => {
  test("a locked override shows the not-delivered status text", () => {
    renderCell(StatusCell as never, {
      ...baseRow,
      title: "Credit repayment schedule",
      lockedOverride: true,
      lockedOverrideI18nKey: "templateResolver.overview.lockedOverride",
    });

    const badge = screen.getByTestId("document-designer-locked-override");
    expect(badge.textContent).toBe("Not delivered");
    expect(badge.parentElement?.getAttribute("title")).toContain("not delivered");
  });

  test("a row without a locked override shows no such text", () => {
    renderCell(StatusCell as never, {
      ...baseRow,
      title: "Credit repayment schedule",
      lockedOverride: false,
      lockedOverrideI18nKey: null,
    });

    expect(screen.queryByTestId("document-designer-locked-override")).toBeNull();
  });

  test("a title that is an i18n key shows the translation, plain titles stay as seeded", () => {
    renderCell(TitleCell as never, {
      ...baseRow,
      title: "moneyHorse:template.creditSchedule.title",
    });
    expect(screen.getByText("Credit repayment schedule")).toBeTruthy();
  });

  test("a plain title is shown unchanged", () => {
    renderCell(TitleCell as never, { ...baseRow, title: "Rechnung Hausverwaltung" });
    expect(screen.getByText("Rechnung Hausverwaltung")).toBeTruthy();
  });
});
