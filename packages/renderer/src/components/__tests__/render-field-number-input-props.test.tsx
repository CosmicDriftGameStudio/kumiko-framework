// RenderField hands the app locale, the field `grouping` option and the
// integer constraint to the number Input, so a year can opt out of
// thousands separators ("2021" instead of "2.021").

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.js";
import { type CorePrimitives, type InputProps, PrimitivesProvider } from "../../primitives.js";
import { RenderField } from "../render-field.js";

type NumberInputProps = Extract<InputProps, { readonly kind: "number" }>;
const capture: { props: InputProps | undefined } = { props: undefined };
const captureInput: ComponentType<InputProps> = (props) => {
  capture.props = props;
  return null;
};
// Function boundary keeps TS from narrowing the slot to the `undefined` reset.
function readCaptured(): InputProps | undefined {
  return capture.props;
}
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

function numberInputProps(
  type: "number" | "bigInt" | "decimal",
  grouping: boolean | undefined,
): NumberInputProps {
  capture.props = undefined;
  const field: EditFieldViewModel = {
    field: "year",
    label: "Year",
    type,
    value: 2021,
    visible: true,
    readOnly: false,
    required: false,
    ...(grouping !== undefined && { grouping }),
  };
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "de-DE" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  const props = readCaptured();
  if (props === undefined || props.kind !== "number") {
    throw new Error("number Input was not rendered");
  }
  return props;
}

describe("RenderField number Input props", () => {
  test("grouping=false and the app locale reach the number Input", () => {
    const props = numberInputProps("number", false);
    expect(props).toMatchObject({ kind: "number", locale: "de-DE", grouping: false });
  });

  test("grouping stays unset when the field does not declare it", () => {
    expect(numberInputProps("number", undefined).grouping).toBeUndefined();
  });

  test("bigInt is integer-only, decimal is not", () => {
    expect(numberInputProps("bigInt", undefined).integer).toBe(true);
    expect(numberInputProps("decimal", undefined).integer).toBeUndefined();
  });
});
