// Regression: field types without a dedicated widget (embedded
// without embeddedListCells, jsonb) must render read-only
// instead of falling back to a text input. The old default-branch
// fallback ran the value through stringValue() — an object/array turned
// into "[object Object]"/"a,b", and saving that overwrote the real data.
// multiSelect gained a real combobox widget (so it dropped out of this
// list); files/images got FileListField later and left it too.
//
// Capture-Input/Banner instead of real primitives, same pattern as
// render-field-app-locale.test.tsx.

import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import type { EditFieldViewModel } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { kumikoDefaultTranslations } from "../../i18n-defaults.ts";
import {
  type BannerProps,
  type CorePrimitives,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives.tsx";
import { RenderField } from "../render-field.tsx";

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
      resolver={createStaticLocaleResolver({ locale: "en" })}
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
])("RenderField — %s without a widget", (_name, field) => {
  test("renders a read-only banner instead of an editable text input", () => {
    renderField(field);
    expect(capturedInput).toBeUndefined();
    expect(capturedBanner).toBeDefined();
    expect(capturedBanner?.variant).toBe("info");
    // The surrounding <Field> always renders a <label htmlFor={id}> —
    // without an id on the Banner itself that label points at nothing.
    expect(capturedBanner?.id).toBe("kumiko-edit-positions");
  });

  // The Banner used to show only the generic hint, hiding the
  // actual field value from the user entirely (not even read-only).
  test("shows the underlying value read-only alongside the generic hint", () => {
    renderField(field);
    const children = capturedBanner?.children;
    const childArray = Array.isArray(children) ? children : [children];
    expect(childArray[0]).toBe("This field type can't be edited here yet.");
    const valuePreview = childArray[1] as { props: { children: unknown } } | false | undefined;
    if (!valuePreview) throw new Error("expected a value-preview element");
    expect(valuePreview.props.children).toBe(JSON.stringify(field.value));
  });
});

describe("RenderField — files/images have a widget", () => {
  test.each(["files", "images"] as const)(
    "%s renders file inputs instead of the banner",
    (type) => {
      renderField(baseField({ type, value: [] }));
      expect(capturedBanner).toBeUndefined();
    },
  );
});

describe("unsupported-type banner without a value", () => {
  test("no value preview element when field.value is empty", () => {
    renderField(baseField({ type: "jsonb", value: null }));
    const children = capturedBanner?.children;
    const childArray = Array.isArray(children) ? children : [children];
    expect(childArray[0]).toBe("This field type can't be edited here yet.");
    expect(childArray[1]).toBeFalsy();
  });
});

describe("text remains editable", () => {
  test("plain text field still renders a text input, not a banner", () => {
    renderField(baseField({ type: "text", value: "hallo" }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("text");
  });
});

// Field types that gained a real widget on the auto-wired
// entityEdit path (previously either no widget at all or a type-mismatched
// text-input fallback).
describe("RenderField — new widgets", () => {
  test("multiSelect renders a multi-combobox instead of a banner", () => {
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

  test("decimal renders a number input instead of text (no more string fallback)", () => {
    renderField(baseField({ type: "decimal", value: 12.5 }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("number");
    if (capturedInput?.kind !== "number") return;
    expect(capturedInput.value).toBe(12.5);
  });

  test("bigInt renders a number input instead of text (no more string fallback)", () => {
    renderField(baseField({ type: "bigInt", value: 42 }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("number");
    if (capturedInput?.kind !== "number") return;
    expect(capturedInput.value).toBe(42);
  });

  test("tz renders a dedicated tz input instead of text", () => {
    renderField(baseField({ type: "tz", value: "Europe/Berlin" }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("tz");
    if (capturedInput?.kind !== "tz") return;
    expect(capturedInput.value).toBe("Europe/Berlin");
  });

  test("longText always renders a textarea, even without an explicit multiline flag", () => {
    renderField(baseField({ type: "longText", value: "lange Notiz" }));
    expect(capturedBanner).toBeUndefined();
    expect(capturedInput).toBeDefined();
    expect(capturedInput?.kind).toBe("textarea");
  });
});
