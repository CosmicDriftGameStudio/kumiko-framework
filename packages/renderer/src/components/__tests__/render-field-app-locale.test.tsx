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

function dateField(): EditFieldViewModel {
  return {
    field: "dueAt",
    label: "Fällig",
    type: "date",
    value: "2026-01-15",
    visible: true,
    readOnly: false,
    required: false,
  };
}

function renderUnderLocale(locale: string, field: EditFieldViewModel = moneyField()): void {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
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
    // Unconditional zuerst — ohne sie wäre der Test bei falschem kind leer.
    expect(captured?.kind).toBe("money");
    if (captured?.kind === "money") expect(captured.locale).toBe("en-US");
  });
});

describe("RenderField — App-Locale an date durchreichen", () => {
  test("date ohne field.locale bekommt das App-Locale (de-DE)", () => {
    renderUnderLocale("de-DE", dateField());
    expect(captured?.kind).toBe("date");
    if (captured?.kind === "date") expect(captured.locale).toBe("de-DE");
  });
});

describe("RenderField — min/max/dateLocale ans Picker-Input durchreichen (#369)", () => {
  test("date-Feld: min/max/dateLocale landen in den InputProps", () => {
    const field: EditFieldViewModel = {
      ...dateField(),
      min: "2020-01-01",
      max: "2026-12-31",
      dateLocale: "en-US",
    };
    renderUnderLocale("de-DE", field);
    expect(captured?.kind).toBe("date");
    if (captured?.kind === "date") {
      expect(captured.min).toBe("2020-01-01");
      expect(captured.max).toBe("2026-12-31");
      // dateLocale (per-Feld) hat Vorrang vor dem App-Locale (de-DE).
      expect(captured.locale).toBe("en-US");
    }
  });

  test("timestamp-Feld: min/max landen in den InputProps", () => {
    const field: EditFieldViewModel = {
      field: "at",
      label: "Zeitpunkt",
      type: "timestamp",
      value: "",
      visible: true,
      readOnly: false,
      required: false,
      min: "2026-01-01T00:00:00Z",
      max: "2026-12-31T23:59:59Z",
    };
    renderUnderLocale("de-DE", field);
    expect(captured?.kind).toBe("timestamp");
    if (captured?.kind === "timestamp") {
      expect(captured.min).toBe("2026-01-01T00:00:00Z");
      expect(captured.max).toBe("2026-12-31T23:59:59Z");
    }
  });
});
