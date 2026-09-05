// Editable number-field unit-of-measure suffix (static or sibling-field
// reference). Complements render-field-unit-format.test.tsx, which only
// covers the pre-existing read-only `format: "unit"` FieldRenderer path —
// this feature is display-only decoration on the editable Input widget,
// never a value conversion.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { computeEditViewModel, type EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
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

function buildEntity(
  mileageUnit: string | { readonly field: string } | undefined,
): EntityDefinition {
  return {
    fields: {
      mileage: {
        type: "number",
        required: false,
        ...(mileageUnit !== undefined && { unit: mileageUnit }),
      },
      mileageUnit: { type: "text", required: false },
    },
  } as EntityDefinition;
}

function buildScreen(): EntityEditScreenDefinition {
  return {
    id: "vehicle-edit",
    type: "entityEdit",
    entity: "vehicle",
    layout: { sections: [{ columns: 1, fields: ["mileage", "mileageUnit"] }] },
  } as EntityEditScreenDefinition;
}

function mileageField(
  entity: EntityDefinition,
  values: Record<string, unknown>,
): EditFieldViewModel {
  const vm = computeEditViewModel({
    screen: buildScreen(),
    entity,
    values,
    translate: (key) => key,
    featureName: "fleet",
  });
  const section = vm.sections[0];
  if (section === undefined || section.kind !== "fields") {
    throw new Error("expected a fields section");
  }
  const field = section.fields.find((f) => f.field === "mileage");
  if (field === undefined) throw new Error("expected a mileage field");
  return field;
}

function currentInput(): InputProps {
  if (captured === undefined) throw new Error("expected an Input to be captured");
  return captured;
}

function renderMileageField(
  entity: EntityDefinition,
  values: Record<string, unknown>,
  row?: Record<string, unknown>,
): InputProps {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField
          field={mileageField(entity, values)}
          onChange={() => {}}
          {...(row !== undefined && { row })}
        />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  if (captured === undefined) throw new Error("mileage field did not render an Input");
  return captured;
}

describe("RenderField — editable number unit suffix", () => {
  test("static unit resolves onto Input.unit, value stays untouched", () => {
    const field = renderMileageField(buildEntity("km"), { mileage: 58 });
    expect(field.kind).toBe("number");
    if (field.kind !== "number") return;
    expect(field.unit).toBe("km");
    expect(field.value).toBe(58);
  });

  test("no unit configured: Input.unit is undefined", () => {
    const field = renderMileageField(buildEntity(undefined), { mileage: 58 });
    expect(field.kind).toBe("number");
    if (field.kind !== "number") return;
    expect(field.unit).toBeUndefined();
  });

  test("sibling-field unit resolves from the live row and updates when the sibling changes", () => {
    const entity = buildEntity({ field: "mileageUnit" });
    captured = undefined;
    const { rerender } = render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
        <PrimitivesProvider value={testPrimitives}>
          <RenderField
            field={mileageField(entity, { mileage: 58, mileageUnit: "mi" })}
            onChange={() => {}}
            row={{ mileage: 58, mileageUnit: "mi" }}
          />
        </PrimitivesProvider>
      </LocaleProvider>,
    );
    const first = currentInput();
    if (first.kind !== "number") throw new Error("expected a number Input");
    expect(first.unit).toBe("mi");

    captured = undefined;
    rerender(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
        <PrimitivesProvider value={testPrimitives}>
          <RenderField
            field={mileageField(entity, { mileage: 58, mileageUnit: "km" })}
            onChange={() => {}}
            row={{ mileage: 58, mileageUnit: "km" }}
          />
        </PrimitivesProvider>
      </LocaleProvider>,
    );
    const second = currentInput();
    if (second.kind !== "number") throw new Error("expected a number Input");
    expect(second.unit).toBe("km");
  });

  test("missing sibling field: no suffix, no crash, no guessed default", () => {
    const entity = buildEntity({ field: "mileageUnit" });
    const field = renderMileageField(entity, { mileage: 58 }, { mileage: 58 });
    expect(field.kind).toBe("number");
    if (field.kind !== "number") return;
    expect(field.unit).toBeUndefined();
  });

  test("empty-string sibling value: no suffix, no guessed default", () => {
    const entity = buildEntity({ field: "mileageUnit" });
    const field = renderMileageField(
      entity,
      { mileage: 58, mileageUnit: "" },
      {
        mileage: 58,
        mileageUnit: "",
      },
    );
    expect(field.kind).toBe("number");
    if (field.kind !== "number") return;
    expect(field.unit).toBeUndefined();
  });
});
