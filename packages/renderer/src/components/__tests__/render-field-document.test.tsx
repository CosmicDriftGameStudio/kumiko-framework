// Document-editor longText fields hold HTML: an emptied editor must read as "" and the
// read-only text display must not show markup.

import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { type ContentEditorProps, ContentEditorsProvider } from "../../app/content-editors.tsx";
import type { EditFieldViewModel } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import { type CorePrimitives, PrimitivesProvider, type TextProps } from "../../primitives.tsx";
import { RenderField } from "../render-field.tsx";

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;
const PlainText: ComponentType<TextProps> = ({ children }) => (
  <span data-testid="plain">{children}</span>
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
  Text: PlainText,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

function ClearingEditor({ onChange }: ContentEditorProps) {
  return (
    <button type="button" onClick={() => onChange("<p></p>")}>
      clear
    </button>
  );
}

function documentField(overrides: Partial<EditFieldViewModel> = {}): EditFieldViewModel {
  return {
    field: "body",
    label: "Body",
    type: "longText",
    editor: "document",
    value: "<p>Hello <strong>Anna</strong></p>",
    visible: true,
    readOnly: false,
    required: true,
    ...overrides,
  };
}

function renderField(
  field: EditFieldViewModel,
  onChange: (value: unknown) => void,
  valueDisplay?: "form" | "text",
): void {
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
      <PrimitivesProvider value={testPrimitives}>
        <ContentEditorsProvider value={{ document: ClearingEditor }}>
          <RenderField
            field={field}
            onChange={onChange}
            {...(valueDisplay !== undefined && { valueDisplay })}
          />
        </ContentEditorsProvider>
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField document editor", () => {
  test("an emptied editor reports an empty string, not an empty paragraph", () => {
    const seen: unknown[] = [];
    renderField(documentField(), (value) => seen.push(value));
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(seen).toEqual([""]);
  });

  test("the read-only text display shows plain text without markup", () => {
    renderField(documentField({ readOnly: true }), () => {}, "text");
    expect(screen.getByTestId("plain").textContent).toBe("Hello Anna");
  });
});
