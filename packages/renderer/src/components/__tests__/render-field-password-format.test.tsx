// fw#2548: TextFieldDef.format "password" is a pure render hint — the
// editable widget masks the input, and the read-only display never shows
// the plaintext value.

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import {
  type CorePrimitives,
  type InputProps,
  PrimitivesProvider,
  type TextProps,
} from "../../primitives";
import { RenderField } from "../render-field";

let capturedInput: InputProps | undefined;
const captureInput: ComponentType<InputProps> = (props) => {
  capturedInput = props;
  return null;
};
let capturedText: TextProps | undefined;
const captureText: ComponentType<TextProps> = (props) => {
  capturedText = props;
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
  Text: captureText,
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
    field: "apiToken",
    label: "API token",
    type: "text",
    value: "s3cr3t",
    visible: true,
    readOnly: false,
    required: false,
    ...overrides,
  };
}

function renderField(field: EditFieldViewModel, valueDisplay?: "form" | "text"): void {
  capturedInput = undefined;
  capturedText = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField
          field={field}
          onChange={() => {}}
          {...(valueDisplay !== undefined && { valueDisplay })}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — format: 'password'", () => {
  test("editable password field renders Input kind=password", () => {
    renderField(textField({ format: "password" }));
    expect(capturedInput?.kind).toBe("password");
  });

  test("a plain text field (no format) still renders Input kind=text", () => {
    renderField(textField());
    expect(capturedInput?.kind).toBe("text");
  });

  test("read-only password field shows a fixed mask, never the plaintext", () => {
    renderField(textField({ format: "password", readOnly: true }), "text");
    expect(capturedText?.children).toBe("••••••••");
  });

  test("read-only password field with an empty value shows the empty placeholder, not the mask", () => {
    renderField(textField({ format: "password", readOnly: true, value: "" }), "text");
    expect(capturedText?.children).toBe("—");
  });
});
