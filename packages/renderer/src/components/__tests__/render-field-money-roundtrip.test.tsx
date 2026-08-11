// kumiko-framework#1923: money didn't round-trip on the auto-wired
// entityEdit path — create sent a bare number against the server's
// `{amount, currency}` schema, update rendered the rehydrated read value as
// NaN, and a naive fix would have been 100x off (minor vs. major units).
//
// This test walks the whole chain with real functions, no mocks:
// computeEditViewModel (headless) → RenderField → simulated widget
// onChange → buildInsertSchema/buildUpdateSchema (framework/engine). The
// widget's own minor-units math (MoneyInput) is pinned separately in
// packages/renderer-web/src/primitives/__tests__/money-input.test.tsx —
// this test starts one step in, at the value RenderField hands to/from the
// widget contract (`number | ""` minor units).

import { describe, expect, test } from "bun:test";
import { rehydrateMoney } from "@cosmicdrift/kumiko-framework/db";
import { buildInsertSchema, buildUpdateSchema } from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { computeEditViewModel, type EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives";
import { RenderField } from "../render-field";

let captured: InputProps | undefined;
const captureInput: ComponentType<InputProps> = (props) => {
  captured = props;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: noop,
  Field: passChildren,
  Input: captureInput,
  DataTable: noop,
  Form: noop,
  Section: noop,
  Card: noop,
  Grid: noop,
  GridCell: noop,
  Text: noop,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

function buildEntity(defaultCurrency: string): EntityDefinition {
  return {
    fields: {
      price: { type: "money", required: true },
    },
    defaultCurrency,
  } as EntityDefinition;
}

function buildScreen(): EntityEditScreenDefinition {
  return {
    id: "product-edit",
    type: "entityEdit",
    entity: "product",
    layout: { sections: [{ columns: 1, fields: ["price"] }] },
  } as EntityEditScreenDefinition;
}

function priceField(entity: EntityDefinition, values: Record<string, unknown>): EditFieldViewModel {
  const vm = computeEditViewModel({
    screen: buildScreen(),
    entity,
    values,
    translate: (key) => key,
    featureName: "shop",
  });
  const section = vm.sections[0];
  if (section === undefined || section.kind !== "fields") {
    throw new Error("expected a fields section");
  }
  const field = section.fields[0];
  if (field === undefined) throw new Error("expected a price field");
  return field;
}

function renderMoneyField(
  entity: EntityDefinition,
  values: Record<string, unknown>,
  onChange: (v: unknown) => void,
): InputProps {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={priceField(entity, values)} onChange={onChange} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  if (captured === undefined) throw new Error("money field did not render an Input");
  return captured;
}

describe("RenderField money round-trip (kumiko-framework#1923)", () => {
  test("create: untouched required field, buildInitialValues default validates against buildInsertSchema", () => {
    const entity = buildEntity("USD");
    // Same default shape kumiko-screen.tsx's buildInitialValues produces
    // for a money field once a defaultCurrency is threaded through.
    const initialPrice = { amount: 0, currency: "USD" };
    const result = buildInsertSchema(entity).safeParse({ price: initialPrice });
    expect(result.success).toBe(true);
  });

  test("create: user-entered amount becomes a payload that validates against buildInsertSchema", () => {
    const entity = buildEntity("USD");
    let payload: unknown;
    const field = renderMoneyField(entity, {}, (v) => {
      payload = v;
    });
    expect(field.kind).toBe("money");
    if (field.kind !== "money") return;
    expect(field.value).toBe(""); // untouched — empty widget state, not NaN/0
    field.onChange(1299); // widget emits minor units: 12.99 USD
    expect(payload).toEqual({ amount: 12.99, currency: "USD" });
    const result = buildInsertSchema(entity).safeParse({ price: payload });
    expect(result.success).toBe(true);
  });

  test("update: server-rehydrated value renders as a real number, not NaN (regression)", () => {
    const entity = buildEntity("USD");
    const row = { price: 1299, priceCurrency: "USD" };
    const record = rehydrateMoney(row, entity);
    const field = renderMoneyField(entity, record, () => {});
    expect(field.kind).toBe("money");
    if (field.kind !== "money") return;
    expect(field.value).toBe(1299);
    expect(Number.isNaN(field.value)).toBe(false);
  });

  test("update: edited amount becomes a payload that validates against buildUpdateSchema", () => {
    const entity = buildEntity("USD");
    const row = { price: 1299, priceCurrency: "USD" };
    const record = rehydrateMoney(row, entity);
    let payload: unknown;
    const field = renderMoneyField(entity, record, (v) => {
      payload = v;
    });
    if (field.kind !== "money") throw new Error("expected money kind");
    field.onChange(1500); // user edits to 15.00
    expect(payload).toEqual({ amount: 15, currency: "USD" });
    const result = buildUpdateSchema(entity).safeParse({ price: payload });
    expect(result.success).toBe(true);
  });

  test("JPY (zero-decimal currency): amountMinor is not read, so the widget value is not 100x off", () => {
    const entity = buildEntity("JPY");
    // DB stores minor units at the framework's flat MINOR_UNIT_SCALE=100,
    // so ¥500 is row-stored as 50000 — rehydrateMoney's amountMinor mirrors
    // that scale, which disagrees with JPY's real 0 decimal places. Reading
    // amountMinor here would render 50000 instead of 500.
    const row = { price: 50000, priceCurrency: "JPY" };
    const record = rehydrateMoney(row, entity);
    let payload: unknown;
    const field = renderMoneyField(entity, record, (v) => {
      payload = v;
    });
    if (field.kind !== "money") throw new Error("expected money kind");
    expect(field.value).toBe(500);
    field.onChange(500); // user submits the same amount unchanged
    expect(payload).toEqual({ amount: 500, currency: "JPY" });
    const result = buildInsertSchema(entity).safeParse({ price: payload });
    expect(result.success).toBe(true);
    expect(result.data?.["price"]).toEqual({ amount: 500, currency: "JPY" });
  });

  test("server schema strips an unexpected amountMinor key instead of rejecting the payload", () => {
    const entity = buildEntity("USD");
    const result = buildUpdateSchema(entity).safeParse({
      price: { amount: 12.99, currency: "USD", amountMinor: 1299 },
    });
    expect(result.success).toBe(true);
    expect(result.data?.["price"]).toEqual({ amount: 12.99, currency: "USD" });
  });
});
