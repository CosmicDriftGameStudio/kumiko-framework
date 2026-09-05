// Fields without a declared icon derive one from the field name — mirrors
// ACTION_ICON_BY_ID/resolveActionIcon (kumiko-screen.tsx) for fields. Only
// kind:"text" (single-line) and kind:"number" structurally carry an icon
// prop, so that's what these tests assert against.

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
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

function textField(overrides: Partial<EditFieldViewModel> = {}): EditFieldViewModel {
  return {
    field: "name",
    label: "Name",
    type: "text",
    value: "",
    visible: true,
    readOnly: false,
    required: false,
    ...overrides,
  };
}

function renderField(field: EditFieldViewModel): void {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — icon derivation from field name/type", () => {
  test("field named 'email' with no declared icon renders the mail icon", () => {
    renderField(textField({ field: "email" }));
    expect(captured?.kind).toBe("text");
    if (captured?.kind === "text") expect(captured.icon).toBe("mail");
  });

  test("a declared field.icon overrides the derivation", () => {
    renderField(textField({ field: "email", icon: "lock" }));
    expect(captured?.kind).toBe("text");
    if (captured?.kind === "text") expect(captured.icon).toBe("lock");
  });

  test("a generic text field with no recognizable name gets no icon", () => {
    renderField(textField({ field: "foo" }));
    expect(captured?.kind).toBe("text");
    if (captured?.kind === "text") expect(captured.icon).toBeUndefined();
  });

  test("a boolean field gets no icon", () => {
    renderField({
      field: "isActive",
      label: "Active",
      type: "boolean",
      value: false,
      visible: true,
      readOnly: false,
      required: false,
    });
    expect(captured?.kind).toBe("boolean");
    if (captured?.kind === "boolean") expect("icon" in captured).toBe(false);
  });

  test("a multiline field named 'email' gets no icon (textarea has no icon slot)", () => {
    renderField(textField({ field: "email", multiline: true }));
    expect(captured?.kind).toBe("textarea");
    if (captured?.kind === "textarea") expect("icon" in captured).toBe(false);
  });

  test("a number field with no recognizable name gets no icon", () => {
    renderField({
      field: "quantity",
      label: "Quantity",
      type: "number",
      value: 1,
      visible: true,
      readOnly: false,
      required: false,
    });
    expect(captured?.kind).toBe("number");
    if (captured?.kind === "number") expect(captured.icon).toBeUndefined();
  });
});
