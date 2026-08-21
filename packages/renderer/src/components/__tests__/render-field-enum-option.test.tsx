// fw#2315: a projectionDetail field with `renderer: { format: "enumOption",
// keyPrefix }` must resolve the raw enum value through useTranslation() —
// the same key convention buildOptionLabels uses for entityList select
// columns (`<feature>:entity:<entity>:field:<field>:option:<value>`), but
// for the FieldRendererOutput (readOnly + declared FormatSpec) path.
//
// DoD-Test: rendering the SAME field under two locales must produce two
// DIFFERENT labels — not just prove the format key exists.

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider, type TranslationsByLocale } from "../../i18n";
import { type CorePrimitives, PrimitivesProvider, type TextProps } from "../../primitives";
import { RenderField } from "../render-field";

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

const STATUS_KEY_PREFIX = "contact:entity:contact:field:status:option:";

const STATUS_BUNDLES: TranslationsByLocale = {
  de: { [`${STATUS_KEY_PREFIX}active`]: "Aktiv" },
  en: { [`${STATUS_KEY_PREFIX}active`]: "Active" },
};

function statusField(value: unknown = "active"): EditFieldViewModel {
  return {
    field: "status",
    label: "Status",
    type: "text",
    value,
    visible: true,
    readOnly: true,
    required: false,
    renderer: { format: "enumOption", keyPrefix: STATUS_KEY_PREFIX },
  };
}

function renderUnderLocale(locale: string, field: EditFieldViewModel): void {
  captured = undefined;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale })}
      fallbackBundles={[STATUS_BUNDLES]}
    >
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — enumOption-FormatSpec (fw#2315)", () => {
  test("dieselbe Maske unter zwei Locales rendert zwei verschiedene Beschriftungen", () => {
    renderUnderLocale("de", statusField());
    expect(captured?.children).toBe("Aktiv");

    renderUnderLocale("en", statusField());
    expect(captured?.children).toBe("Active");
  });

  test("unbekannter Options-Key fällt auf den Rohwert zurück, nicht auf den i18n-Key", () => {
    renderUnderLocale("de", statusField("archived"));
    expect(captured?.children).toBe("archived");
  });

  test("leerer Wert rendert leer", () => {
    renderUnderLocale("de", statusField(null));
    expect(captured?.children).toBe("");
  });
});
