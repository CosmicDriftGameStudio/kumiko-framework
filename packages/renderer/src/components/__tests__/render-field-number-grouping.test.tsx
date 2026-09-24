// Read-only number display (`field.readOnly: true`, no own `renderer`) goes
// through readOnlyDisplayText's own Intl.NumberFormat call, independent of
// the headless `applyFormatSpec` path already covered by
// format.test.tsx — `field.grouping` gates it the same way (fw#3234).

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import { type CorePrimitives, PrimitivesProvider, type TextProps } from "../../primitives";
import { RenderField } from "../render-field";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const DefaultText = ({ testId, children }: TextProps): ReactNode => (
  <span data-testid={testId}>{children}</span>
);

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
  Text: DefaultText,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

function numberField(grouping: boolean | undefined): EditFieldViewModel {
  return {
    field: "population",
    label: "Population",
    type: "number",
    value: 2021,
    visible: true,
    readOnly: true,
    required: false,
    ...(grouping !== undefined && { grouping }),
  };
}

function renderReadOnly(locale: string, grouping: boolean | undefined): string {
  cleanup();
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={numberField(grouping)} onChange={() => {}} valueDisplay="text" />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  return screen.getByTestId("field-value-population").textContent ?? "";
}

describe("RenderField — read-only number grouping (fw#3234)", () => {
  test("groups thousands by default, locale-aware", () => {
    expect(renderReadOnly("en-US", undefined)).toBe("2,021");
    expect(renderReadOnly("de-DE", undefined)).toBe("2.021");
  });

  test("grouping: false renders the digits without a thousands separator", () => {
    expect(renderReadOnly("en-US", false)).toBe("2021");
    expect(renderReadOnly("de-DE", false)).toBe("2021");
  });
});
