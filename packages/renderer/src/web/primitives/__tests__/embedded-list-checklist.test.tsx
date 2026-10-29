// Inspection-checklist rendering of EmbeddedListInput: per-row hidden/required/derived cells,
// the phone card layout with touch targets, and file cells uploading with a subField.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function renderWithLocale(ui: ReactElement) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      {ui}
    </LocaleProvider>,
  );
}

const isMeasurement = (row: Readonly<Record<string, unknown>>) => row["kind"] === "measurement";
const isNotOk = (row: Readonly<Record<string, unknown>>) => row["result"] === "not_ok";

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
    field: "measured",
    label: "Measured",
    type: "number",
    required: false,
    derived: false,
    isHiddenInRow: (row) => !isMeasurement(row),
  },
  {
    field: "result",
    label: "Result",
    type: "select",
    required: false,
    derived: false,
    display: "radio",
    options: ["ok", "not_ok"],
    optionLabels: { ok: "OK", not_ok: "Not OK" },
    optionTones: { ok: "ok", not_ok: "bad" },
    isDerivedInRow: isMeasurement,
  },
  {
    field: "finding",
    label: "Finding",
    type: "text",
    required: false,
    derived: false,
    isHiddenInRow: (row) => !isNotOk(row),
    isRequiredInRow: isNotOk,
  },
  {
    field: "photos",
    label: "Photos",
    type: "images",
    required: false,
    derived: false,
    maxCount: 2,
    isHiddenInRow: (row) => !isNotOk(row),
  },
];

const ROWS = [
  { label: "Guard fitted", kind: "check", result: "ok" },
  { label: "Bolt torque", kind: "measurement", measured: 210, result: "not_ok", finding: "High" },
];

function props(overrides: Partial<EmbeddedListInputProps> = {}): EmbeddedListInputProps {
  return {
    id: "cp",
    columns: COLUMNS,
    rows: ROWS,
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
    uploadTarget: { entityType: "inspection", fieldName: "checkpoints", entityId: "e1" },
    ...overrides,
  };
}

const cell = (row: number, field: string) =>
  document.querySelector(`[data-cell-id="cp-${row}-${field}"]`);

describe("EmbeddedListInput — per-row cells (table)", () => {
  test("hidden cells render no control, derived select shows a badge, visible ones stay", () => {
    renderWithLocale(<EmbeddedListInput {...props()} />);
    expect(cell(0, "measured")).toBeNull();
    expect(cell(0, "finding")).toBeNull();
    expect(cell(1, "measured")).not.toBeNull();
    expect(cell(1, "finding")).not.toBeNull();
    // row 0 (check): editable segment; row 1 (measurement): derived, read-only badge
    expect(cell(0, "result")?.querySelector("[role=radiogroup]")).not.toBeNull();
    expect(cell(1, "result")?.querySelector("[role=radiogroup]")).toBeNull();
    expect(cell(1, "result")?.textContent).toContain("Not OK");
  });
});

describe("EmbeddedListInput — phone cards", () => {
  test("title shows row number and label, controls are touch sized, hidden cells are omitted", () => {
    const originalWidth = window.innerWidth;
    setViewportWidth(390);
    try {
      renderWithLocale(<EmbeddedListInput {...props()} />);
      expect(screen.getByTestId("cp-row-0-title").textContent).toBe("1 Guard fitted");
      expect(screen.queryByText(/^Finding/, { selector: "span" })).not.toBeNull();
      expect(cell(0, "finding")).toBeNull();
      for (const radio of cell(0, "result")?.querySelectorAll("[role=radio]") ?? []) {
        expect(radio.className).toContain("min-h-11");
      }
      expect(cell(1, "measured")?.className ?? "").toContain("h-11");
    } finally {
      setViewportWidth(originalWidth);
    }
  });
});

describe("EmbeddedListInput — file cell", () => {
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
  afterEach(() => fetchSpy?.mockRestore());

  test("uploads with the list field and the cell as subField and appends the new ref", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111" }), { status: 200 }),
    );
    const changes: unknown[] = [];
    renderWithLocale(
      <EmbeddedListInput
        {...props({ onCellChange: (_row, field, value) => changes.push([field, value]) })}
      />,
    );
    const input = cell(1, "photos")?.querySelector("input[type=file]");
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(changes[0]).toEqual(["photos", ["11111111-1111-4111-8111-111111111111"]]);
    const body = fetchSpy.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("fieldName")).toBe("checkpoints");
    expect(form.get("subField")).toBe("photos");
  });

  test("maxCount hides the add tile; read-only rows show no add or remove controls", () => {
    const full = ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    const { unmount } = renderWithLocale(
      <EmbeddedListInput {...props({ rows: [{ ...ROWS[1], photos: full }] })} />,
    );
    expect(cell(0, "photos")?.querySelector("input[type=file]")).toBeNull();
    unmount();
    renderWithLocale(
      <EmbeddedListInput {...props({ rows: [{ ...ROWS[1], photos: full }], disabled: true })} />,
    );
    expect(cell(0, "photos")?.querySelectorAll("button")).toHaveLength(0);
  });
});
