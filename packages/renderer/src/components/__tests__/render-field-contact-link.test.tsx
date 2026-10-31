// Read-only text fields with format "email" / "phone" render as mailto: / tel: links.

import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import type { EditFieldViewModel } from "../../headless/index.ts";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n.tsx";
import {
  type CorePrimitives,
  type LinkProps,
  PrimitivesProvider,
  type TextProps,
} from "../../primitives.tsx";
import { RenderField } from "../render-field.tsx";

let capturedLink: LinkProps | undefined;
const captureLink: ComponentType<LinkProps> = (props) => {
  capturedLink = props;
  return null;
};
let capturedText: TextProps | undefined;
const captureText: ComponentType<TextProps> = (props) => {
  capturedText = props;
  return null;
};
const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

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
  Text: captureText,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: captureLink,
};

function renderReadOnly(format: EditFieldViewModel["format"], value: unknown): void {
  capturedLink = undefined;
  capturedText = undefined;
  const field: EditFieldViewModel = {
    field: "contact",
    label: "Contact",
    type: "text",
    value,
    visible: true,
    readOnly: true,
    required: false,
    ...(format !== undefined && { format }),
  };
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
      <PrimitivesProvider value={testPrimitives}>
        <RenderField field={field} onChange={() => {}} valueDisplay="text" />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField read-only contact formats", () => {
  test("email renders a mailto link", () => {
    renderReadOnly("email", "ada@example.com");
    expect(capturedLink?.href).toBe("mailto:ada@example.com");
    expect(capturedLink?.children).toBe("ada@example.com");
  });

  test("the link is underlined so it reads as a link next to plain values", () => {
    renderReadOnly("email", "ada@example.com");
    expect(capturedLink?.className).toContain("underline");
  });

  test("phone renders a tel link with digits and a leading plus only", () => {
    renderReadOnly("phone", "+49 (30) 123-45");
    expect(capturedLink?.href).toBe("tel:+493012345");
    expect(capturedLink?.children).toBe("+49 (30) 123-45");
  });

  test("phone without plus keeps digits only", () => {
    renderReadOnly("phone", "030 / 123");
    expect(capturedLink?.href).toBe("tel:030123");
  });

  test("empty value and non-contact formats stay plain text", () => {
    renderReadOnly("email", "");
    expect(capturedLink).toBeUndefined();
    expect(capturedText?.children).toBe("—");
    renderReadOnly("url", "https://example.com");
    expect(capturedLink).toBeUndefined();
  });

  test("a phone value without digits stays plain text", () => {
    renderReadOnly("phone", "n/a");
    expect(capturedLink).toBeUndefined();
    expect(capturedText?.children).toBe("n/a");
  });
});
