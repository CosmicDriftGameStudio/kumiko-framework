// Read-only text display (valueDisplay="text") per field type, via readOnlyDisplayText.
import { describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { type EditFieldViewModel, EMPTY_VALUE_PLACEHOLDER } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { type CorePrimitives, PrimitivesProvider, type TextProps } from "../../primitives.tsx";
import { RenderField } from "../render-field.tsx";

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

function renderText(
  partial: Partial<EditFieldViewModel> & Pick<EditFieldViewModel, "type" | "value">,
  locale = "en-US",
): string {
  cleanup();
  const field: EditFieldViewModel = {
    field: "f",
    label: "F",
    visible: true,
    readOnly: true,
    required: false,
    ...partial,
  };
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} valueDisplay="text" />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
  return screen.getByTestId("field-value-f").textContent ?? "";
}

describe("RenderField — read-only text per field type", () => {
  test("date and timestamp honour dateLocale over the app locale", () => {
    const date = renderText({ type: "date", value: "2024-03-05" }, "en-US");
    const dateDe = renderText({ type: "date", value: "2024-03-05", dateLocale: "de-DE" }, "en-US");
    expect(date).not.toBe(dateDe);
    expect(dateDe).toContain("05");
    const ts = renderText({ type: "timestamp", value: "2024-03-05T12:00:00Z" }, "en-US");
    const tsDe = renderText(
      { type: "timestamp", value: "2024-03-05T12:00:00Z", dateLocale: "de-DE" },
      "en-US",
    );
    expect(ts).not.toBe(tsDe);
  });

  test("locatedTimestamp prefers utc over at and shows a placeholder when at is empty", () => {
    const withUtc = renderText({
      type: "locatedTimestamp",
      value: { at: "2024-03-05T12:00:00", tz: "Europe/Berlin", utc: "2024-03-05T11:00:00Z" },
    });
    const utcOnly = renderText({ type: "timestamp", value: "2024-03-05T11:00:00Z" });
    expect(withUtc).toBe(utcOnly);
    expect(renderText({ type: "locatedTimestamp", value: { at: "", tz: "UTC" } })).toBe(
      EMPTY_VALUE_PLACEHOLDER,
    );
  });

  test("select maps values to option labels and keeps unknown values", () => {
    const optionLabels = { a: "Alpha", b: "Beta" };
    expect(renderText({ type: "select", value: "a", optionLabels })).toBe("Alpha");
    expect(renderText({ type: "select", value: "zzz", optionLabels })).toBe("zzz");
    expect(renderText({ type: "multiSelect", value: ["a", "b"], optionLabels })).toBe(
      "Alpha, Beta",
    );
  });

  test("empty multiSelect array and unknown types fall back", () => {
    expect(renderText({ type: "multiSelect", value: [] })).toBe(EMPTY_VALUE_PLACEHOLDER);
    expect(renderText({ type: "text", value: "plain" })).toBe("plain");
  });
});
