// Regression: RenderField muss das App-Locale (useLocale) an money-/date-
// Inputs durchreichen — auch ohne explizites field.locale. Vorher fielen
// die Inputs auf navigator.language (Browser-Sprache) statt der per
// LocaleProvider gewählten App-Sprache zurück → Separator-Mismatch.
//
// Capture-Input statt echter Primitive: hält den Test renderer-intern
// (relativer Import von RenderField → diese Source), unabhängig davon
// wie @cosmicdrift/* im Workspace aufgelöst wird.

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
  Grid: noop,
  GridCell: noop,
  Text: noop,
  Heading: noop,
  Dialog: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
};

function moneyField(): EditFieldViewModel {
  return {
    field: "price",
    label: "Preis",
    type: "money",
    value: 123456,
    visible: true,
    readOnly: false,
    required: false,
  };
}

function renderUnderLocale(locale: string): void {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={moneyField()} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — App-Locale an money durchreichen", () => {
  test("money ohne field.locale bekommt das App-Locale (de-DE)", () => {
    renderUnderLocale("de-DE");
    expect(captured?.kind).toBe("money");
    if (captured?.kind === "money") expect(captured.locale).toBe("de-DE");
  });

  test("ein anderes App-Locale wird ebenso durchgereicht (en-US)", () => {
    renderUnderLocale("en-US");
    if (captured?.kind === "money") expect(captured.locale).toBe("en-US");
  });
});
