// Regression #1834: field types without a dedicated widget (embedded
// without embeddedListCells, jsonb, files, images) must render read-only
// instead of falling back to a text input. The old default-branch
// fallback ran the value through stringValue() — an object/array turned
// into "[object Object]"/"a,b", and saving that overwrote the real data.
// #1925 gave multiSelect a real combobox widget (so it dropped out of this
// list) and moved files/images in (no multi-upload widget yet, deliberately
// deferred — they used to hit the same text-input corruption via the
// default branch).
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
  ["files", baseField({ type: "files", value: ["11111111-1111-1111-1111-111111111111"] })],
  ["images", baseField({ type: "images", value: ["11111111-1111-1111-1111-111111111111"] })],
])("RenderField — %s ohne Widget", (_name, field) => {
  test("rendert einen schreibgeschützten Banner statt eines editierbaren Text-Inputs", () => {
    renderField(field);
    expect(capturedInput).toBeUndefined();
    expect(capturedBanner).toBeDefined();
    expect(capturedBanner?.variant).toBe("info");
    // The surrounding <Field> always renders a <label htmlFor={id}> —
    // without an id on the Banner itself that label points at nothing (#1834 review).
    expect(capturedBanner?.id).toBe("kumiko-edit-positions");
  });

  // #1847#6: the Banner used to show only the generic hint, hiding the
  // actual field value from the user entirely (not even read-only).
  test("shows the underlying value read-only alongside the generic hint", () => {
    renderField(field);
    const children = capturedBanner?.children;
    const childArray = Array.isArray(children) ? children : [children];
    expect(childArray[0]).toBe("Dieser Feldtyp kann hier noch nicht bearbeitet werden.");
    const valuePreview = childArray[1] as { props: { children: unknown } } | false | undefined;
    expect(valuePreview).toBeTruthy();
    expect(valuePreview && valuePreview.props.children).toBe(JSON.stringify(field.value));
  });
});

describe("RenderField — unsupported-type Banner ohne Wert", () => {
  test("kein Value-Preview-Element wenn field.value leer ist", () => {
    renderField(baseField({ type: "jsonb", value: null }));
    const children = capturedBanner?.children;
    const childArray = Array.isArray(children) ? children : [children];
    expect(childArray[0]).toBe("Dieser Feldtyp kann hier noch nicht bearbeitet werden.");
    expect(childArray[1]).toBeFalsy();
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

// #1925: field types that gained a real widget on the auto-wired
// entityEdit path (previously either no widget at all or a type-mismatched
// text-input fallback).
describe("RenderField — #1925 neue Widgets", () => {
  test("multiSelect rendert eine Multi-Combobox statt eines Banners", () => {
    renderField(
      baseField({
        type: "multiSelect",
        value: ["a"],
        options: ["a", "b"],
      }),
    );
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("combobox");
    if (capturedInput?.kind !== "combobox") return;
    expect(capturedInput.multiple).toBe(true);
    expect(capturedInput.value).toEqual(["a"]);
    expect(capturedInput.options).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ]);
  });

  test("decimal rendert ein number-Input statt Text (kein String-Fallback mehr)", () => {
    renderField(baseField({ type: "decimal", value: 12.5 }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("number");
    if (capturedInput?.kind !== "number") return;
    expect(capturedInput.value).toBe(12.5);
  });

  test("bigInt rendert ein number-Input statt Text (kein String-Fallback mehr)", () => {
    renderField(baseField({ type: "bigInt", value: 42 }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("number");
    if (capturedInput?.kind !== "number") return;
    expect(capturedInput.value).toBe(42);
  });

  test("tz rendert ein dediziertes tz-Input statt Text", () => {
    renderField(baseField({ type: "tz", value: "Europe/Berlin" }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("tz");
    if (capturedInput?.kind !== "tz") return;
    expect(capturedInput.value).toBe("Europe/Berlin");
  });

  test("longText rendert immer ein textarea, auch ohne explizites multiline-Flag", () => {
    renderField(baseField({ type: "longText", value: "lange Notiz" }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("textarea");
  });
});
