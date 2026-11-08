import { describe, expect, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  synthesizeProjectionEntity,
  synthesizeProjectionScreen,
} from "../../app/projection-list-shim.ts";
import { enrichReferenceColumns } from "../../components/render-list-reference-columns.ts";
import { EMPTY_VALUE_PLACEHOLDER, type ListColumnViewModel } from "../../headless/index.ts";
import { RenderList } from "../../index.ts";
import { HintCell } from "../primitives/data-table/hint-cell.tsx";
import { defaultPrimitives } from "../primitives/index.tsx";
import { atViewportWidth, cleanup, render, screen } from "./test-utils.tsx";

const { DataTable } = defaultPrimitives;

function renderProjectionList(
  columns: ProjectionListScreenDefinition["columns"],
  rows: readonly Record<string, unknown>[],
) {
  const projection: ProjectionListScreenDefinition = {
    id: "orders-list",
    type: "projectionList",
    query: "orders:query:list",
    columns,
  };
  return render(
    <RenderList
      screen={synthesizeProjectionScreen(projection)}
      entity={synthesizeProjectionEntity(columns, false)}
      rows={rows}
      featureName="orders"
    />,
  );
}

describe("projectionList value type alignment", () => {
  test("money and number columns are right-aligned in header and cells, text stays left", () => {
    renderProjectionList(
      [
        { field: "name", label: "Name" },
        { field: "total", label: "Total", valueType: "money" },
        { field: "qty", label: "Qty", valueType: "number" },
      ],
      [{ id: "r1", name: "A", total: { amount: 12.5, currency: "EUR" }, qty: 3 }],
    );
    for (const field of ["total", "qty"]) {
      expect(screen.getByTestId(`column-${field}`).classList.contains("text-right")).toBe(true);
      expect(screen.getByTestId(`cell-r1-${field}`).classList.contains("text-right")).toBe(true);
    }
    expect(screen.getByTestId("column-name").classList.contains("text-right")).toBe(false);
    expect(screen.getByTestId("cell-r1-total").textContent).toContain("12");
  });
});

describe("column emptyPlaceholder", () => {
  const rows = [{ id: "r1", name: "A", note: null }];

  test("an empty cell stays blank by default", () => {
    renderProjectionList([{ field: "name" }, { field: "note" }], rows);
    expect(screen.getByTestId("cell-r1-note").textContent).toBe("");
  });

  test("a string emptyPlaceholder shows in the empty cell", () => {
    renderProjectionList(
      [{ field: "name" }, { field: "note", emptyPlaceholder: EMPTY_VALUE_PLACEHOLDER }],
      rows,
    );
    expect(screen.getByTestId("cell-r1-note").textContent).toBe(EMPTY_VALUE_PLACEHOLDER);
  });

  test("emptyPlaceholder: false leaves the cell blank", () => {
    renderProjectionList([{ field: "name" }, { field: "note", emptyPlaceholder: false }], rows);
    expect(screen.getByTestId("cell-r1-note").textContent).toBe("");
    expect(screen.getByTestId("cell-r1-name").textContent).toBe("A");
  });
});

describe("hint sentence with the neutral tone", () => {
  const hintColumns = (plainSentence: boolean) =>
    [
      {
        field: "next",
        label: "Next",
        type: "text",
        sortable: false,
        hint: {
          emptyLabel: "Nothing open",
          reasonLabel: "Why?",
          toneField: "tone",
          ...(plainSentence && { plainSentence: true }),
        },
      },
    ] as const;
  const rows = (tone: string) => [{ id: "r1", values: { next: "Completed", tone } }];

  test("neutral draws the sentence muted and not bold, like the empty label", () => {
    render(<DataTable columns={hintColumns(false)} rows={rows("neutral")} />);
    const sentence = screen.getByText("Completed");
    expect(sentence.className).toContain("text-muted-foreground");
    expect(sentence.className).toContain("font-normal");
    expect(sentence.className).not.toContain("font-medium");
  });

  test("a toned sentence stays bold in the tone color", () => {
    render(<DataTable columns={hintColumns(false)} rows={rows("bad")} />);
    const sentence = screen.getByText("Completed");
    expect(sentence.className).toContain("text-status-bad");
    expect(sentence.className).toContain("font-medium");
  });

  test("plainSentence opts out of the dimming", () => {
    render(<DataTable columns={hintColumns(true)} rows={rows("neutral")} />);
    expect(screen.getByText("Completed").className).not.toContain("text-muted-foreground");
  });

  test("the phone card dims it too and draws no tone stripe", () => {
    atViewportWidth(500, () => {
      render(<DataTable columns={hintColumns(false)} rows={rows("neutral")} />);
      const sentence = screen.getByText("Completed");
      expect(sentence.className).toContain("text-muted-foreground");
      expect(document.body.innerHTML).not.toContain("before:w-1");
    });
  });
});

describe("emptyPlaceholder on reference columns", () => {
  const refColumn = (emptyPlaceholder: string | false | undefined): ListColumnViewModel => ({
    field: "owner",
    label: "Owner",
    type: "reference",
    sortable: false,
    refEntity: "user",
    ...(emptyPlaceholder !== undefined && { emptyPlaceholder }),
  });
  const cellText = (column: ListColumnViewModel, value: unknown): HTMLElement => {
    const [enriched] = enrichReferenceColumns({
      columns: [column],
      referenceColumns: [
        { field: "owner", refEntity: "user", refFeature: "orders", labelField: "id" },
      ],
      referenceLookups: {},
      resolveReferenceLink: () => undefined,
      featureName: "orders",
      translate: (key) => key,
    });
    if (enriched === undefined) throw new Error("column missing");
    render(<DataTable columns={[enriched]} rows={[{ id: "r1", values: { owner: value } }]} />);
    return screen.getByTestId("cell-r1-owner");
  };

  test("empty scalar and empty array stay blank with emptyPlaceholder: false or by default", () => {
    for (const placeholder of [false as const, undefined]) {
      for (const empty of [null, "", []]) {
        const cell = cellText(refColumn(placeholder), empty);
        expect(cell.textContent).toBe("");
        cleanup();
      }
    }
  });

  test("a configured placeholder shows muted in an empty reference cell, translated like any cell", () => {
    for (const empty of [null, "", []]) {
      const cell = cellText(refColumn(EMPTY_VALUE_PLACEHOLDER), empty);
      expect(cell.textContent).toBe(EMPTY_VALUE_PLACEHOLDER);
      expect(cell.querySelector("[data-empty-cell]")?.className).toContain("text-muted-foreground");
      cleanup();
    }
  });
});

describe("clickable hint sentence with the neutral tone", () => {
  const hint = { emptyLabel: "Nothing", reasonLabel: "Why?", toneField: "tone" };
  const sentenceButton = (tone: string) => {
    render(<HintCell value="Completed" row={{ tone }} hint={hint} onOpen={() => {}} />);
    return screen.getByText("Completed");
  };

  test("neutral: button is muted and not font-medium", () => {
    const button = sentenceButton("neutral");
    expect(button.tagName).toBe("BUTTON");
    expect(button.className).toContain("font-normal");
    expect(button.className).toContain("text-muted-foreground");
    expect(button.className).not.toContain("font-medium");
  });

  test("a toned sentence keeps font-medium", () => {
    expect(sentenceButton("warn").className).toContain("font-medium");
  });
});
