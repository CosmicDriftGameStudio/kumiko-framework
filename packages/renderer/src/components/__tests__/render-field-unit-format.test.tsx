// readOnly fields with an explicit `field.renderer: { format: "unit" }`
// must render through applyFormatSpec's unit case, and default to the
// LocaleProvider's App-Locale when the FormatSpec itself carries no `locale`
// — same posture as render-field-app-locale.test.tsx for money/date inputs,
// but for the FieldRendererOutput (readOnly + declared renderer) path, which
// that file doesn't cover.
//
// Capture-Text instead of a real primitive, same pattern as
// render-field-app-locale.test.tsx (Capture-Input there).

import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import type { EditFieldViewModel } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { type CorePrimitives, PrimitivesProvider, type TextProps } from "../../primitives.tsx";
import { RenderField } from "../render-field.tsx";

let captured: TextProps | undefined;
const captureText: ComponentType<TextProps> = (props) => {
  captured = props;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: noop,
  Field: passChildren,
  Input: noop,
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

function livingSpaceField(
  renderer: EditFieldViewModel["renderer"],
  value: unknown = 58,
): EditFieldViewModel {
  return {
    field: "livingSpace",
    label: "Wohnfläche",
    type: "decimal",
    value,
    visible: true,
    readOnly: true,
    required: false,
    renderer,
  };
}

function renderUnderLocale(locale: string, field: EditFieldViewModel): void {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — unit-FormatSpec", () => {
  test("m2 renders number + m² suffix, formatted according to the App locale", () => {
    renderUnderLocale("de-DE", livingSpaceField({ format: "unit", unit: "m2" }));
    expect(captured?.children).toBe("58 m²");
  });

  test("a different App locale changes number formatting (en-US: period instead of comma)", () => {
    renderUnderLocale("en-US", livingSpaceField({ format: "unit", unit: "m2" }, 58.5));
    expect(captured?.children).toBe("58.5 m²");
  });

  test("CLDR-sanctioned unit (km) renders via Intl.NumberFormat(style:'unit')", () => {
    renderUnderLocale("en-US", livingSpaceField({ format: "unit", unit: "km" }, 3));
    expect(captured?.children).toBe("3 km");
  });

  test("explicit renderer.locale takes precedence over the App locale", () => {
    renderUnderLocale("en-US", livingSpaceField({ format: "unit", unit: "m2", locale: "de-DE" }));
    expect(captured?.children).toBe("58 m²");
  });
});

describe("RenderField — pass App locale through to FieldRendererOutput", () => {
  test("number-FormatSpec without its own locale receives the App locale (de-DE, comma instead of period)", () => {
    renderUnderLocale("de-DE", livingSpaceField({ format: "number" }, 1234.5));
    expect(captured?.children).toBe("1.234,5");
  });

  test("explicit locale: undefined still falls back to App-Locale", () => {
    renderUnderLocale("de-DE", livingSpaceField({ format: "number", locale: undefined }, 1234.5));
    expect(captured?.children).toBe("1.234,5");
  });
});
