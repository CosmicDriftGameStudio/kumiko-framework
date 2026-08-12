// kumiko-framework#1972: one form, two money contracts. A top-level money
// field's write payload is `{amount, currency}` in MAJOR units
// (render-field.tsx's moneyPayload) while an embedded-list row's money
// sub-field is a bare number in MINOR units (embedded-list-field.tsx passes
// the widget's minor-unit value straight through — currency lives on the
// head aggregate, not the row). Both are correct in isolation; the risk is
// a consumer that reads the combined payload and compares the two amounts
// without converting units first (exactly the reported solon incident:
// `linesSum:10000` vs `netTotal:100`).
//
// This test drives BOTH real conversion paths — RenderField's moneyPayload
// for the top-level field, EmbeddedListField's handleCellChange for the
// list rows — with a crooked amount (not a round number, which can hide a
// factor-of-100 bug by coincidence), assembles the resulting wire payload
// exactly like a real form submission would, and validates it against the
// real server schema (buildInsertSchema + EmbeddedFieldDef.totalsMatch). No
// hand-built wire-form fixture stands in for either conversion function.

import { describe, expect, test } from "bun:test";
import {
  buildInsertSchema,
  createEmbeddedListField,
  createEntity,
  createMoneyField,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { computeEditViewModel, type EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import {
  type CorePrimitives,
  type EmbeddedListInputProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives";
import { RenderField } from "../render-field";

let capturedInput: InputProps | undefined;
let capturedList: EmbeddedListInputProps | undefined;
let lastTotalPayload: unknown;
let lastLinesPayload: unknown;

const captureInput: ComponentType<InputProps> = (props) => {
  capturedInput = props;
  return null;
};
const captureEmbeddedListInput: ComponentType<EmbeddedListInputProps> = (props) => {
  capturedList = props;
  return null;
};
const onTotalChange = (v: unknown): void => {
  lastTotalPayload = v;
};
const onLinesChange = (v: unknown): void => {
  lastLinesPayload = v;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: noop,
  Field: passChildren,
  Input: captureInput,
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

function invoiceEntity(): EntityDefinition {
  return createEntity({
    table: "Invoices",
    fields: {
      total: createMoneyField({ required: true }),
      lines: createEmbeddedListField(
        { amount: { type: "money", required: true } },
        { totalsMatch: { amount: "total" } },
      ),
    },
    defaultCurrency: "EUR",
  });
}

function invoiceScreen(): EntityEditScreenDefinition {
  return {
    id: "invoice-edit",
    type: "entityEdit",
    entity: "invoice",
    layout: { sections: [{ columns: 1, fields: ["total", "lines"] }] },
  } as EntityEditScreenDefinition;
}

function computeInvoiceFields(
  entity: EntityDefinition,
  values: Record<string, unknown>,
): { readonly total: EditFieldViewModel; readonly lines: EditFieldViewModel } {
  const vm = computeEditViewModel({
    screen: invoiceScreen(),
    entity,
    values,
    translate: (key) => key,
    featureName: "invoices",
  });
  const section = vm.sections[0];
  if (section === undefined || section.kind !== "fields") {
    throw new Error("expected a fields section");
  }
  const total = section.fields.find((f) => f.field === "total");
  const lines = section.fields.find((f) => f.field === "lines");
  if (total === undefined || lines === undefined) {
    throw new Error("expected total + lines fields");
  }
  return { total, lines };
}

// Mounts both fields fresh against the given values and re-captures their
// widget props. Called again after every simulated edit — a real controlled
// form re-renders with the previous onChange result fed back in the same
// way, so this mirrors that instead of mutating one long-lived tree.
function renderInvoiceForm(entity: EntityDefinition, values: Record<string, unknown>): void {
  capturedInput = undefined;
  capturedList = undefined;
  const { total, lines } = computeInvoiceFields(entity, values);
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={total} onChange={onTotalChange} />
        <RenderField field={lines} onChange={onLinesChange} featureName="invoices" />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  if (capturedInput === undefined) {
    throw new Error("total field did not render an Input");
  }
  if (capturedList === undefined) {
    throw new Error("lines field did not render an EmbeddedListInput");
  }
}

// Mirrors what MoneyInput actually emits on blur: the widget's minor-units
// value. `InputProps` is a discriminated union keyed by `kind`, so the
// money-typed onChange only narrows to a callable signature once `kind` is
// checked.
function emitMoneyChange(minorUnits: number): void {
  if (capturedInput === undefined) throw new Error("no Input captured");
  if (capturedInput.kind !== "money") throw new Error("expected a money Input");
  capturedInput.onChange(minorUnits);
}

describe("RenderField money contract consistency across top-level + embedded-list (kumiko-framework#1972)", () => {
  test("a crooked invoice total (1234.56 EUR) whose line amounts sum to the same value validates end to end", () => {
    const entity = invoiceEntity();

    // Two rows, edited one at a time via the widget's real onCellChange
    // (minor units) — each edit re-renders with the previous result fed
    // back in as `lines`, exactly like a real controlled form.
    renderInvoiceForm(entity, { lines: [{}, {}] });
    capturedList?.onCellChange(0, "amount", 100_000); // 1000.00 EUR
    expect(lastLinesPayload).toEqual([{ amount: 100_000 }, {}]);

    renderInvoiceForm(entity, { lines: lastLinesPayload as Record<string, unknown>[] });
    capturedList?.onCellChange(1, "amount", 23_456); // 234.56 EUR
    expect(lastLinesPayload).toEqual([{ amount: 100_000 }, { amount: 23_456 }]);

    // Top-level total: the widget (MoneyInput) emits minor units on blur;
    // RenderField's moneyPayload converts that to the wire's major-unit
    // object.
    emitMoneyChange(123_456); // 1234.56 EUR, minor units
    expect(lastTotalPayload).toEqual({ amount: 1234.56, currency: "EUR" });

    const result = buildInsertSchema(entity).safeParse({
      total: lastTotalPayload,
      lines: lastLinesPayload,
    });
    expect(result.success).toBe(true);
  });

  test("a genuinely wrong total (mismatched, not just a unit mixup) is still rejected", () => {
    const entity = invoiceEntity();
    renderInvoiceForm(entity, { lines: [{}] });
    capturedList?.onCellChange(0, "amount", 100_000); // 1000.00 EUR
    expect(lastLinesPayload).toEqual([{ amount: 100_000 }]);

    emitMoneyChange(50_000); // user enters 500.00 EUR — doesn't match the line
    expect(lastTotalPayload).toEqual({ amount: 500, currency: "EUR" });

    const result = buildInsertSchema(entity).safeParse({
      total: lastTotalPayload,
      lines: lastLinesPayload,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === "lines")).toBe(true);
    }
  });
});
