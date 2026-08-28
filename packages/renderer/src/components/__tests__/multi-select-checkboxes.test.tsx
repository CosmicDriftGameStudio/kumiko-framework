// display: "checkboxes" on a multiSelect field renders a checkbox grid
// (MultiSelectCheckboxes) instead of the combobox dropdown. Style follows
// render-field-app-locale.test.tsx: mount RenderField under real Locale +
// Primitives providers with capturing stubs, then invoke the captured
// callbacks the way a real primitive implementation would.

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { kumikoDefaultTranslations } from "../../i18n-defaults";
import {
  type ButtonProps,
  type CorePrimitives,
  type GridProps,
  type InputProps,
  PrimitivesProvider,
} from "../../primitives";
import { RenderField } from "../render-field";

let capturedInputs: InputProps[] = [];
let capturedButton: ButtonProps | undefined;
let capturedGrid: GridProps | undefined;

const captureInput: ComponentType<InputProps> = (props) => {
  capturedInputs.push(props);
  return null;
};
const captureButton: ComponentType<ButtonProps> = (props) => {
  capturedButton = props;
  return null;
};
const captureGrid: ComponentType<GridProps> = (props) => {
  capturedGrid = props;
  return <>{props.children}</>;
};
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const noop = (): ReactNode => null;

const testPrimitives: CorePrimitives = {
  Button: captureButton,
  Banner: noop,
  Field: passChildren,
  Input: captureInput,
  DataTable: noop,
  Form: noop,
  Section: noop,
  Card: noop,
  Grid: captureGrid,
  GridCell: passChildren,
  Text: noop,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

function languagesField(overrides: Partial<EditFieldViewModel> = {}): EditFieldViewModel {
  return {
    field: "languages",
    label: "Languages",
    type: "multiSelect",
    value: [],
    visible: true,
    readOnly: false,
    required: false,
    options: ["en", "de", "es"],
    optionLabels: { en: "English", de: "German", es: "Spanish" },
    display: "checkboxes",
    ...overrides,
  };
}

let lastOnChange: unknown;
function renderField(field: EditFieldViewModel): void {
  capturedInputs = [];
  capturedButton = undefined;
  capturedGrid = undefined;
  lastOnChange = undefined;
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver()}
      fallbackBundles={[kumikoDefaultTranslations]}
    >
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={(v) => (lastOnChange = v)} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — multiSelect display: checkboxes", () => {
  test("renders one boolean checkbox per option, no combobox", () => {
    renderField(languagesField());
    expect(capturedInputs).toHaveLength(3);
    for (const input of capturedInputs) {
      expect(input.kind).toBe("boolean");
    }
  });

  test("without display, the field still renders the combobox (back-compat)", () => {
    renderField(languagesField({ display: undefined }));
    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0]?.kind).toBe("combobox");
  });

  test("clicking one checkbox emits the full array including previously-set values, in options order", () => {
    renderField(languagesField({ value: ["en"] }));
    const deInput = capturedInputs.find(
      (i) => i.kind === "boolean" && i.id === "kumiko-edit-languages-de",
    );
    expect(deInput?.kind).toBe("boolean");
    if (deInput?.kind === "boolean") deInput.onChange(true);
    expect(lastOnChange).toEqual(["en", "de"]);
  });

  test("unchecking a checkbox drops only that value, keeping options order", () => {
    renderField(languagesField({ value: ["en", "de", "es"] }));
    const deInput = capturedInputs.find(
      (i) => i.kind === "boolean" && i.id === "kumiko-edit-languages-de",
    );
    if (deInput?.kind === "boolean") deInput.onChange(false);
    expect(lastOnChange).toEqual(["en", "es"]);
  });

  test("select-all toggle shows 'Select all' when nothing is selected, and selects everything in options order", () => {
    renderField(languagesField({ value: [] }));
    expect(capturedButton?.children).toBe("Select all");
    capturedButton?.onClick?.();
    expect(lastOnChange).toEqual(["en", "de", "es"]);
  });

  test("select-all toggle flips to 'Deselect all' once everything is selected, and clears on click", () => {
    renderField(languagesField({ value: ["en", "de", "es"] }));
    expect(capturedButton?.children).toBe("Deselect all");
    capturedButton?.onClick?.();
    expect(lastOnChange).toEqual([]);
  });

  test("disabled (readOnly) disables every checkbox and the select-all toggle", () => {
    renderField(languagesField({ readOnly: true }));
    expect(capturedButton?.disabled).toBe(true);
    for (const input of capturedInputs) {
      expect(input.disabled).toBe(true);
    }
  });

  test("columns and maxRows pass through to the Grid primitive", () => {
    renderField(languagesField({ columns: 2, maxRows: 3 }));
    expect(capturedGrid?.columns).toBe(2);
    expect(capturedGrid?.maxRows).toBe(3);
  });

  test("omitting columns/maxRows keeps the default layout (no maxRows on the Grid)", () => {
    renderField(languagesField());
    expect(capturedGrid?.maxRows).toBeUndefined();
  });
});
