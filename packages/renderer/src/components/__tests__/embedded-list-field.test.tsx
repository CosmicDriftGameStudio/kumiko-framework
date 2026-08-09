// EmbeddedListField Tests — RTL + happy-dom, style follows
// render-field-app-locale.test.tsx: mount under real Locale/Dispatcher/
// Primitives providers, capture the props the (mocked) EmbeddedListInput
// primitive receives, then invoke its callbacks the way the real
// primitive would (a user clicking/typing) and assert the resulting
// onChange call.

import { describe, expect, test } from "bun:test";
import type { Dispatcher, EditFieldViewModel, FieldIssue } from "@cosmicdrift/kumiko-headless";
import { render, waitFor } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { DispatcherProvider } from "../../context/dispatcher-context";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type CorePrimitives,
  type EmbeddedListInputProps,
  PrimitivesProvider,
} from "../../primitives";
import { EmbeddedListField } from "../embedded-list-field";
import { RenderField, type RenderFieldProps } from "../render-field";

let captured: EmbeddedListInputProps | undefined;
const captureEmbeddedListInput: ComponentType<EmbeddedListInputProps> = (props) => {
  captured = props;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

function testPrimitives(): CorePrimitives {
  return {
    Button: noop,
    Banner: noop,
    Field: passChildren,
    Input: noop,
    EmbeddedListInput: captureEmbeddedListInput,
    DataTable: noop,
    Form: passChildren,
    Section: passChildren,
    Card: passChildren,
    Grid: passChildren,
    GridCell: passChildren,
    Text: passChildren,
    Heading: noop,
    Dialog: noop,
    Modal: noop,
    Lightbox: noop,
    ConfigSourceBadge: noop,
    ConfigCascadeView: noop,
    Link: noop,
  };
}

type ProductRow = { readonly id: string; readonly name: string };

function stubDispatcher(productRows: readonly ProductRow[] = []): Dispatcher {
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query: (async (type: string) => {
      if (type === "invoices:query:product:list") {
        return { isSuccess: true, data: { rows: productRows } };
      }
      return { isSuccess: true, data: { rows: [] } };
    }) as unknown as Dispatcher["query"],
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore: {
      getState: () => "online",
      subscribe: () => () => {},
    } as unknown as Dispatcher["statusStore"],
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  };
}

function invoiceLinesField(overrides: Partial<EditFieldViewModel> = {}): EditFieldViewModel {
  return {
    field: "lines",
    label: "Lines",
    type: "embedded",
    value: [],
    visible: true,
    readOnly: false,
    required: true,
    embeddedListCells: [
      {
        field: "product",
        label: "Product",
        type: "reference",
        required: true,
        refEntity: "product",
        refFeature: "invoices",
        refLabelField: "name",
      },
      {
        field: "unit",
        label: "Unit",
        type: "select",
        required: true,
        options: ["pcs", "hours", "kg"],
      },
      { field: "quantity", label: "Qty", type: "number", required: true },
      { field: "unitPrice", label: "Unit Price", type: "money", required: true },
      { field: "amount", label: "Amount", type: "money", required: false },
    ],
    embeddedListDerived: { amount: { op: "multiply", from: ["quantity", "unitPrice"] } },
    embeddedListTotals: ["amount"],
    embeddedListMinItems: 1,
    embeddedListMaxItems: 5,
    ...overrides,
  };
}

function renderEmbeddedListField(
  field: EditFieldViewModel,
  onChange: (v: unknown) => void,
  allIssues: Readonly<Record<string, readonly FieldIssue[]>> = {},
  productRows: readonly ProductRow[] = [],
): void {
  captured = undefined;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher(productRows)}>
        <PrimitivesProvider value={testPrimitives()}>
          <EmbeddedListField
            field={field}
            id="kumiko-edit-lines"
            onChange={onChange}
            allIssues={allIssues}
            featureName="invoices"
          />
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("EmbeddedListField — cell change recomputes derived", () => {
  test("changing quantity updates the cell and recomputes amount in the same row", () => {
    const rows = [{ product: "p1", unit: "pcs", quantity: 2, unitPrice: 500, amount: 1000 }];
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), (v) => {
      lastValue = v;
    });
    captured?.onCellChange(0, "quantity", 4);
    expect(lastValue).toEqual([
      { product: "p1", unit: "pcs", quantity: 4, unitPrice: 500, amount: 2000 },
    ]);
  });

  test("a fractional product on the money-typed amount cell shows the rounded live preview, not the raw fraction", () => {
    const rows = [{ product: "p1", unit: "pcs", quantity: 2, unitPrice: 923, amount: 1846 }];
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), (v) => {
      lastValue = v;
    });
    // 2.5 * 923 = 2307.5 — a fractional minor-unit amount the money target
    // can't store as-is. The live preview must show the rounded value
    // (2308), matching what the server would compute and persist.
    captured?.onCellChange(0, "quantity", 2.5);
    expect(lastValue).toEqual([
      { product: "p1", unit: "pcs", quantity: 2.5, unitPrice: 923, amount: 2308 },
    ]);
  });
});

describe("EmbeddedListField — row operations", () => {
  const rows = [
    { product: "p1", unit: "pcs", quantity: 1, unitPrice: 100, amount: 100 },
    { product: "p2", unit: "hours", quantity: 2, unitPrice: 200, amount: 400 },
  ];

  test("onAddRow appends an empty row with derived recomputed", () => {
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), (v) => {
      lastValue = v;
    });
    captured?.onAddRow();
    expect(lastValue).toEqual([...rows, { amount: undefined }]);
  });

  test("onRemoveRow removes exactly the targeted row", () => {
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), (v) => {
      lastValue = v;
    });
    captured?.onRemoveRow(0);
    expect(lastValue).toEqual([rows[1]]);
  });

  test("onDuplicateRow inserts a copy right after the source row", () => {
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), (v) => {
      lastValue = v;
    });
    captured?.onDuplicateRow(0);
    expect(lastValue).toEqual([rows[0], rows[0], rows[1]]);
  });

  test("onDuplicateRow is a no-op for an out-of-range index", () => {
    let called = false;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), () => {
      called = true;
    });
    captured?.onDuplicateRow(99);
    expect(called).toBe(false);
  });

  test("onMoveRow moves an element from one index to another, immutably", () => {
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), (v) => {
      lastValue = v;
    });
    captured?.onMoveRow(1, 0);
    expect(lastValue).toEqual([rows[1], rows[0]]);
    // original array must stay untouched
    expect(rows).toEqual([
      { product: "p1", unit: "pcs", quantity: 1, unitPrice: 100, amount: 100 },
      { product: "p2", unit: "hours", quantity: 2, unitPrice: 200, amount: 400 },
    ]);
  });

  test("onMoveRow is a no-op for an out-of-range target index", () => {
    let called = false;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), () => {
      called = true;
    });
    captured?.onMoveRow(0, 5);
    expect(called).toBe(false);
  });
});

describe("EmbeddedListField — paste coercion", () => {
  test("pastes number/money/select cells with correct coercion per column type", () => {
    const rows = [{ product: "p1", unit: "pcs", quantity: 1, unitPrice: 100, amount: 100 }];
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows }), (v) => {
      lastValue = v;
    });
    // Columns in order: product, unit, quantity, unitPrice, amount.
    // Paste starting at column index 1 ("unit") for row 0: unit, quantity, unitPrice.
    captured?.onPasteCells?.(0, 1, [["hours", "3", "12,50"]]);
    expect(lastValue).toEqual([
      { product: "p1", unit: "hours", quantity: 3, unitPrice: 1250, amount: 3750 },
    ]);
  });

  test("paste beyond the current rows appends new rows but never past maxItems", () => {
    const rows = [{ product: "p1", unit: "pcs", quantity: 1, unitPrice: 100, amount: 100 }];
    let lastValue: unknown;
    renderEmbeddedListField(invoiceLinesField({ value: rows, embeddedListMaxItems: 2 }), (v) => {
      lastValue = v;
    });
    captured?.onPasteCells?.(0, 2, [
      ["1", "100"],
      ["2", "200"],
      ["3", "300"],
    ]);
    const result = lastValue as readonly Record<string, unknown>[];
    expect(result.length).toBe(2);
  });
});

describe("EmbeddedListField — reference column populated via useQuery", () => {
  test("referenceOptions come from the product list query", async () => {
    renderEmbeddedListField(invoiceLinesField({ value: [] }), () => {}, {}, [
      { id: "p1", name: "Widget A" },
    ]);
    await waitFor(() => {
      const productColumn = captured?.columns.find((c) => c.field === "product");
      expect(productColumn?.referenceOptions).toEqual([{ value: "p1", label: "Widget A" }]);
    });
  });
});

describe("EmbeddedListField — issue grouping wiring", () => {
  test("a lines.0.amount issue is routed as a cellIssue at 0.amount", () => {
    const rows = [{ product: "p1", unit: "pcs", quantity: 1, unitPrice: 100, amount: 100 }];
    const issue: FieldIssue = { path: "lines.0.amount", code: "custom", i18nKey: "Bad amount" };
    renderEmbeddedListField(invoiceLinesField({ value: rows }), () => {}, {
      "lines.0.amount": [issue],
    });
    expect(captured?.cellIssues?.["0.amount"]).toEqual([issue]);
    expect(captured?.rowIssues ?? {}).toEqual({});
    expect(captured?.listIssues ?? []).toEqual([]);
  });

  test("a lines-level issue is routed as a listIssue", () => {
    const issue: FieldIssue = { path: "lines", code: "custom", i18nKey: "Too few lines" };
    renderEmbeddedListField(invoiceLinesField({ value: [] }), () => {}, {
      lines: [issue],
    });
    expect(captured?.listIssues).toEqual([issue]);
  });
});

function renderFieldWithEmbeddedList(
  field: EditFieldViewModel,
  allIssues: RenderFieldProps["allIssues"],
): void {
  captured = undefined;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <DispatcherProvider dispatcher={stubDispatcher()}>
        <PrimitivesProvider value={testPrimitives()}>
          <RenderField
            field={field}
            onChange={() => {}}
            allIssues={allIssues}
            featureName="invoices"
          />
        </PrimitivesProvider>
      </DispatcherProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — routes embedded-list fields to EmbeddedListField (plumbing)", () => {
  test("field.embeddedListCells set → RenderField mounts EmbeddedListField, allIssues propagate", () => {
    const rows = [{ product: "p1", unit: "pcs", quantity: 1, unitPrice: 100, amount: 100 }];
    const issue: FieldIssue = { path: "lines.0.amount", code: "custom", i18nKey: "Bad amount" };
    renderFieldWithEmbeddedList(invoiceLinesField({ value: rows }), {
      "lines.0.amount": [issue],
    });
    expect(captured?.cellIssues?.["0.amount"]).toEqual([issue]);
  });
});
