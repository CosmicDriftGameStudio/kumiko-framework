import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives.js";
import { RenderField } from "../render-field.js";

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

function renderField(field: EditFieldViewModel): void {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver()}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

const base = { visible: true, readOnly: false, required: false } as const;

describe("RenderField value normalisation", () => {
  test("a lower-case stored currency code is normalised instead of falling back", () => {
    renderField({
      ...base,
      field: "price",
      label: "Price",
      type: "money",
      currency: "EUR",
      value: { amount: 5, currency: "usd" },
    });
    expect(captured?.kind === "money" ? captured.currency : undefined).toBe("USD");
  });

  test("a mixed multiSelect value keeps its string entries", () => {
    renderField({
      ...base,
      field: "tags",
      label: "Tags",
      type: "multiSelect",
      options: ["a", "b"],
      value: ["a", { id: "b", label: "B" }],
    });
    expect(
      captured?.kind === "combobox" && captured.multiple === true ? captured.value : [],
    ).toEqual(["a"]);
  });
});
