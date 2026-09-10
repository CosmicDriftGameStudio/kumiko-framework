// SelectFieldDef.display travels the whole declarative chain (#2711):
// EntityDefinition → computeEditViewModel → RenderField → InputProps. Without
// it an app can only hope its labels fall under the renderer's heuristic.

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

const AREAS = ["jobs", "mail", "search", "events", "tenants"] as const;

function buildEntity(display: "radio" | "dropdown" | undefined): EntityDefinition {
  return {
    fields: {
      area: {
        type: "select",
        required: false,
        options: AREAS,
        ...(display !== undefined && { display }),
      },
      tags: {
        type: "multiSelect",
        required: false,
        options: AREAS,
        display: "checkboxes",
      },
    },
  } as EntityDefinition;
}

const editScreen: EntityEditScreenDefinition = {
  id: "ticket-edit",
  type: "entityEdit",
  entity: "ticket",
  layout: { sections: [{ columns: 1, fields: ["area", "tags"] }] },
} as EntityEditScreenDefinition;

function viewModelField(entity: EntityDefinition, fieldName: string): EditFieldViewModel {
  const vm = computeEditViewModel({
    screen: editScreen,
    entity,
    values: { area: "jobs", tags: [] },
    translate: (key) => key,
    featureName: "helpdesk",
  });
  const section = vm.sections[0];
  if (section === undefined || section.kind !== "fields") {
    throw new Error("expected a fields section");
  }
  const field = section.fields.find((f) => f.field === fieldName);
  if (field === undefined) throw new Error(`expected a ${fieldName} field`);
  return field;
}

function renderField(field: EditFieldViewModel): InputProps {
  captured = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  if (captured === undefined) throw new Error("field did not render an Input");
  return captured;
}

describe("RenderField — select display request", () => {
  test('display: "radio" on the field definition reaches the Input', () => {
    const field = viewModelField(buildEntity("radio"), "area");
    expect(field.display).toBe("radio");
    const input = renderField(field);
    expect(input.kind).toBe("select");
    if (input.kind !== "select") return;
    expect(input.display).toBe("radio");
  });

  test('display: "dropdown" on the field definition reaches the Input', () => {
    const input = renderField(viewModelField(buildEntity("dropdown"), "area"));
    expect(input.kind).toBe("select");
    if (input.kind !== "select") return;
    expect(input.display).toBe("dropdown");
  });

  test("no display on the field definition leaves the Input to its own default", () => {
    const field = viewModelField(buildEntity(undefined), "area");
    expect(field.display).toBeUndefined();
    const input = renderField(field);
    expect(input.kind).toBe("select");
    if (input.kind !== "select") return;
    expect(input.display).toBeUndefined();
  });

  test('multiSelect keeps its own "checkboxes" display untouched', () => {
    const field = viewModelField(buildEntity("radio"), "tags");
    expect(field.display).toBe("checkboxes");
  });
});
