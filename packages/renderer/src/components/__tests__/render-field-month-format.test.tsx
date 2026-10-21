// A text field with `format: "month"` renders the month Input kind and
// passes the YYYY-MM string through unchanged.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { computeEditViewModel, type EditFieldViewModel } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives.tsx";
import { RenderField } from "../render-field.tsx";

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

const entity = {
  fields: {
    period: {
      type: "text",
      allowPlaintext: "test fixture value, not personal data",
      required: false,
      format: "month",
    },
  },
} as EntityDefinition;

const screen = {
  id: "run-edit",
  type: "entityEdit",
  entity: "run",
  layout: { sections: [{ columns: 1, fields: ["period"] }] },
} as EntityEditScreenDefinition;

function periodField(values: Record<string, unknown>): EditFieldViewModel {
  const vm = computeEditViewModel({
    screen,
    entity,
    values,
    translate: (key) => key,
    featureName: "billing",
  });
  const section = vm.sections[0];
  if (section === undefined || section.kind !== "fields") throw new Error("fields section");
  const field = section.fields[0];
  if (field === undefined) throw new Error("period field");
  return field;
}

function currentInput(): InputProps {
  if (captured === undefined) throw new Error("no Input rendered");
  return captured;
}

describe("RenderField, month format", () => {
  test("renders the month Input kind and forwards YYYY-MM on change", () => {
    captured = undefined;
    const changes: unknown[] = [];
    render(
      <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
        <PrimitivesProvider value={testPrimitives}>
          <RenderField
            field={periodField({ period: "2026-03" })}
            onChange={(v) => changes.push(v)}
          />
        </PrimitivesProvider>
      </LocaleProvider>,
    );
    const input = currentInput();
    expect(input.kind).toBe("month");
    expect(input.value).toBe("2026-03");
    if (input.kind !== "month") return;
    input.onChange("2026-04");
    expect(changes).toEqual(["2026-04"]);
  });
});
