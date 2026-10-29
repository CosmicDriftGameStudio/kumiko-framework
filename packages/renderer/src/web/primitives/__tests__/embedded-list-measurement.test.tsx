// Number cells share one locale formatter between display and input, and phone cards fold a
// measurement (value + limits + result) into a slim block.

import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { EmbeddedListColumn, EmbeddedListInputProps } from "../../../index.ts";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "../../../index.ts";
import { EmbeddedListInput } from "../embedded-list-input.tsx";

function setViewportWidth(width: number): void {
  (
    window as unknown as { happyDOM: { setInnerWidth: (n: number) => void } }
  ).happyDOM.setInnerWidth(width);
}

function renderWithLocale(ui: ReactElement, locale = "en") {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      {ui}
    </LocaleProvider>,
  );
}

const isMeasurement = (row: Readonly<Record<string, unknown>>) => row["kind"] === "measurement";

const COLUMNS: readonly EmbeddedListColumn[] = [
  {
    field: "label",
    label: "Checkpoint",
    type: "text",
    required: true,
    derived: false,
    readOnly: true,
  },
  {
    field: "kind",
    label: "Kind",
    type: "text",
    required: true,
    derived: false,
    readOnly: true,
    hiddenInCard: true,
  },
  {
    field: "min",
    label: "Min",
    type: "number",
    required: false,
    derived: false,
    readOnly: true,
    hiddenInCard: true,
  },
  {
    field: "max",
    label: "Max",
    type: "number",
    required: false,
    derived: false,
    readOnly: true,
    hiddenInCard: true,
  },
  {
    field: "measured",
    label: "Measured",
    type: "number",
    required: false,
    derived: false,
    cardLimits: { min: "min", max: "max" },
    isHiddenInRow: (row) => !isMeasurement(row),
  },
  {
    field: "result",
    label: "Result",
    type: "select",
    required: false,
    derived: true,
    options: ["ok", "not_ok"],
    optionLabels: { ok: "OK", not_ok: "Not OK" },
    cardAttachedTo: "measured",
  },
];

function props(
  rows: EmbeddedListInputProps["rows"],
  overrides: Partial<EmbeddedListInputProps> = {},
): EmbeddedListInputProps {
  return {
    id: "cp",
    columns: COLUMNS,
    rows,
    fixedRows: true,
    onCellChange: () => {},
    onAddRow: () => {},
    onRemoveRow: () => {},
    onDuplicateRow: () => {},
    onMoveRow: () => {},
    addLabel: "Add",
    actionsLabel: "Actions",
    removeLabel: "Remove",
    duplicateLabel: "Duplicate",
    moveUpLabel: "Up",
    moveDownLabel: "Down",
    emptyLabel: "Empty",
    emptyCtaLabel: "Add first",
    testId: "cp",
    ...overrides,
  };
}

const MEASUREMENT_ROW = {
  label: "Gap",
  kind: "measurement",
  min: 0.05,
  max: 0.2,
  measured: 0.31,
  result: "not_ok",
};

describe("EmbeddedListInput — number cells use one locale formatter", () => {
  test("en: read-only text and input value use '.' decimals", () => {
    renderWithLocale(<EmbeddedListInput {...props([MEASUREMENT_ROW])} />, "en");
    expect(screen.getByTestId("cp-cell-0-min").textContent).toBe("0.05");
    expect((screen.getByLabelText("Measured, row 1") as HTMLInputElement).value).toBe("0.31");
  });

  test("de: read-only text and input value use ',' decimals", () => {
    renderWithLocale(<EmbeddedListInput {...props([MEASUREMENT_ROW])} />, "de");
    expect(screen.getByTestId("cp-cell-0-min").textContent).toBe("0,05");
    expect((screen.getByLabelText("Measured, row 1") as HTMLInputElement).value).toBe("0,31");
  });

  test("de: typing '0,4' reports 0.4", () => {
    const changes: unknown[][] = [];
    renderWithLocale(
      <EmbeddedListInput
        {...props([MEASUREMENT_ROW], {
          onCellChange: (row, field, value) => changes.push([row, field, value]),
        })}
      />,
      "de",
    );
    const input = screen.getByLabelText("Measured, row 1");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0,4" } });
    expect(changes).toContainEqual([0, "measured", 0.4]);
  });
});

describe("EmbeddedListInput — measurement phone cards", () => {
  function withMobile(run: () => void): void {
    const originalWidth = window.innerWidth;
    setViewportWidth(390);
    try {
      run();
    } finally {
      setViewportWidth(originalWidth);
    }
  }

  test("steering and limit columns get no label; limits show as a hint; result sits unlabeled", () => {
    withMobile(() => {
      renderWithLocale(<EmbeddedListInput {...props([MEASUREMENT_ROW])} />);
      const mobile = screen.getByTestId("cp-mobile");
      for (const hidden of ["Kind", "Min", "Max", "Result"]) {
        expect(
          [...mobile.querySelectorAll("span")].some((span) => span.textContent === hidden),
        ).toBe(false);
      }
      expect(screen.getByTestId("cp-cell-0-measured-limits").textContent).toBe("Limit 0.05 to 0.2");
      expect(document.querySelector('[data-cell-id="cp-0-result"]')?.textContent).toContain(
        "Not OK",
      );
    });
  });

  test("only a minimum reads 'At least'", () => {
    withMobile(() => {
      renderWithLocale(<EmbeddedListInput {...props([{ ...MEASUREMENT_ROW, max: undefined }])} />);
      expect(screen.getByTestId("cp-cell-0-measured-limits").textContent).toBe("At least 0.05");
    });
  });

  test("a row without limits shows no hint", () => {
    withMobile(() => {
      renderWithLocale(
        <EmbeddedListInput {...props([{ ...MEASUREMENT_ROW, min: undefined, max: undefined }])} />,
      );
      expect(screen.queryByTestId("cp-cell-0-measured-limits")).toBeNull();
    });
  });

  test("the result still renders unlabeled when its anchor is hidden in the row", () => {
    withMobile(() => {
      renderWithLocale(
        <EmbeddedListInput {...props([{ label: "Guard", kind: "check", result: "ok" }])} />,
      );
      expect(document.querySelector('[data-cell-id="cp-0-measured"]')).toBeNull();
      expect(document.querySelector('[data-cell-id="cp-0-result"]')?.textContent).toContain("OK");
      expect(
        [...screen.getByTestId("cp-mobile").querySelectorAll("span")].some(
          (span) => span.textContent === "Result",
        ),
      ).toBe(false);
    });
  });
});
