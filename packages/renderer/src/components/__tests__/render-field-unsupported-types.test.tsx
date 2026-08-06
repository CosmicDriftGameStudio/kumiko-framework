// Regression #1834: field types without a dedicated widget (embedded
// without embeddedListCells, jsonb, multiSelect) must render read-only
// instead of falling back to a text input. The old default-branch
// fallback ran the value through stringValue() — an object/array turned
// into "[object Object]"/"a,b", and saving that overwrote the real data.
//
// Capture-Input/Banner instead of real primitives, same pattern as
// render-field-app-locale.test.tsx.

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type BannerProps,
  type CorePrimitives,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives";
import { RenderField } from "../render-field";

let capturedInput: InputProps | undefined;
let capturedBanner: BannerProps | undefined;
const captureInput: ComponentType<InputProps> = (props) => {
  capturedInput = props;
  return null;
};
const captureBanner: ComponentType<BannerProps> = (props) => {
  capturedBanner = props;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const testPrimitives: CorePrimitives = {
  Button: noop,
  Banner: captureBanner,
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

function baseField(overrides: Partial<EditFieldViewModel>): EditFieldViewModel {
  return {
    field: "positions",
    label: "Positionen",
    type: "text",
    value: null,
    visible: true,
    readOnly: false,
    required: false,
    ...overrides,
  };
}

function renderField(field: EditFieldViewModel): void {
  capturedInput = undefined;
  capturedBanner = undefined;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe.each([
  ["embedded (kein embeddedListCells)", baseField({ type: "embedded", value: { note: "x" } })],
  ["jsonb", baseField({ type: "jsonb", value: { a: 1 } })],
  ["multiSelect", baseField({ type: "multiSelect", value: ["a", "b"] })],
])("RenderField — %s ohne Widget", (_name, field) => {
  test("rendert einen schreibgeschützten Banner statt eines editierbaren Text-Inputs", () => {
    renderField(field);
    expect(capturedInput).toBeUndefined();
    expect(capturedBanner).toBeDefined();
    expect(capturedBanner?.variant).toBe("info");
    expect(capturedBanner?.children).toBe("Dieser Feldtyp kann hier noch nicht bearbeitet werden.");
    // The surrounding <Field> always renders a <label htmlFor={id}> —
    // without an id on the Banner itself that label points at nothing (#1834 review).
    expect(capturedBanner?.id).toBe("kumiko-edit-positions");
  });
});

describe("RenderField — text bleibt weiterhin editierbar", () => {
  test("plain text-Feld rendert weiterhin ein Text-Input, kein Banner", () => {
    renderField(baseField({ type: "text", value: "hallo" }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("text");
  });
});
