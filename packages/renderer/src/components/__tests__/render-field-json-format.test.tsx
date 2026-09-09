// fw#2312: readOnly fields with `field.renderer: { format: "json" }` (audit
// payload/metadata, job logs) must hand the RAW value to a registered
// JsonView primitive — applyFormatSpec's already-indented string is only
// the fallback for a primitives-provider without JsonView (e.g. an app
// predating this rollout). "children contains \n" is not a discriminating
// assertion here (applyFormatSpec already returns a real newline string
// today) — the test instead checks that JsonView is actually invoked and
// receives the structured value, not a flattened string.
//
// Capture-primitives instead of real ones, same pattern as
// render-field-unit-format.test.tsx.

import { describe, expect, test } from "bun:test";
import type { EditFieldViewModel } from "@cosmicdrift/kumiko-headless";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { createStaticLocaleResolver, LocaleProvider } from "../../i18n";
import {
  type CorePrimitives,
  type JsonViewProps,
  PrimitivesProvider,
  type TextProps,
} from "../../primitives";
import { RenderField } from "../render-field";

let capturedJsonView: JsonViewProps | undefined;
const captureJsonView: ComponentType<JsonViewProps> = (props) => {
  capturedJsonView = props;
  return null;
};

let capturedText: TextProps | undefined;
const captureText: ComponentType<TextProps> = (props) => {
  capturedText = props;
  return null;
};

const noop = (): ReactNode => null;
const passChildren = ({ children }: { readonly children?: ReactNode }): ReactNode => children;

const basePrimitives: Omit<CorePrimitives, "Text" | "JsonView"> = {
  Button: noop,
  // Passes children through (not noop): the "unsupported jsonb" fallback
  // path wraps its Text/JsonView content in <Banner>, so a Banner that
  // swallows children would silently never mount them, making those
  // captures a no-op regardless of which branch RenderField actually took.
  Banner: passChildren,
  Field: passChildren,
  Input: noop,
  DataTable: noop,
  Form: noop,
  Section: noop,
  Card: noop,
  Grid: noop,
  GridCell: noop,
  Heading: noop,
  Dialog: noop,
  Modal: noop,
  Lightbox: noop,
  ConfigSourceBadge: noop,
  ConfigCascadeView: noop,
  Link: noop,
};

const primitivesWithJsonView: CorePrimitives = {
  ...basePrimitives,
  Text: captureText,
  JsonView: captureJsonView,
};

const primitivesWithoutJsonView: CorePrimitives = {
  ...basePrimitives,
  Text: captureText,
};

function payloadField(
  value: unknown,
  renderer: EditFieldViewModel["renderer"] = { format: "json" },
): EditFieldViewModel {
  return {
    field: "payload",
    label: "Payload",
    type: "jsonb",
    value,
    visible: true,
    readOnly: true,
    required: false,
    renderer,
  };
}

// No `renderer` key at all (not even `renderer: undefined`, which a default
// parameter would still override) — this is the "no author-declared
// FieldRenderer" case that falls through to renderInput's jsonb/embedded/
// files/images fallback banner instead of FieldRendererOutput.
function unrenderedJsonbField(value: unknown): EditFieldViewModel {
  return {
    field: "payload",
    label: "Payload",
    type: "jsonb",
    value,
    visible: true,
    readOnly: true,
    required: false,
  };
}

function renderPayload(primitives: CorePrimitives, field: EditFieldViewModel): void {
  capturedJsonView = undefined;
  capturedText = undefined;
  render(
    <LocaleProvider resolver={createStaticLocaleResolver({ locale: "en-US" })}>
      <PrimitivesProvider value={primitives}>
        <RenderField field={field} onChange={() => {}} />
      </PrimitivesProvider>
    </LocaleProvider>,
  );
}

describe("RenderField — format: json (fw#2312)", () => {
  test("mit registriertem JsonView bekommt es den rohen, strukturierten Wert — keinen flachen String", () => {
    const value = { user: { id: 1, roles: ["admin", "billing"] } };
    renderPayload(primitivesWithJsonView, payloadField(value));
    expect(capturedJsonView?.value).toBe(value);
    expect(typeof capturedJsonView?.value).toBe("object");
    expect(capturedText).toBeUndefined();
  });

  test("renderer.indent wird an JsonView durchgereicht", () => {
    renderPayload(primitivesWithJsonView, payloadField({ a: 1 }, { format: "json", indent: 4 }));
    expect(capturedJsonView?.indent).toBe(4);
  });

  test("ohne registriertes JsonView fällt es auf Text mit dem von applyFormatSpec formatierten String zurück", () => {
    const value = { a: 1 };
    renderPayload(primitivesWithoutJsonView, payloadField(value));
    expect(capturedJsonView).toBeUndefined();
    expect(capturedText?.children).toBe(JSON.stringify(value, null, 2));
  });

  test("ein zirkulärer Wert erreicht JsonView unverändert — die Aufbereitung ist Sache der Primitive-Implementierung, nicht von RenderField", () => {
    const circular: Record<string, unknown> = { name: "job-1" };
    circular["self"] = circular;
    expect(() => renderPayload(primitivesWithJsonView, payloadField(circular))).not.toThrow();
    expect(capturedJsonView?.value).toBe(circular);
  });
});

describe("RenderField — unsupported jsonb/embedded/files/images Fallback-Banner (fw#2312)", () => {
  test("mit registriertem JsonView zeigt der Banner den Wert strukturiert statt als JSON.stringify-Einzeiler", () => {
    const value = { assignee: "user-1", tags: ["a", "b"] };
    renderPayload(primitivesWithJsonView, unrenderedJsonbField(value));
    expect(capturedJsonView?.value).toBe(value);
    expect(capturedText).toBeUndefined();
  });

  test("ohne registriertes JsonView fällt der Banner auf Text variant=code mit dem alten Einzeiler zurück", () => {
    const value = { assignee: "user-1" };
    renderPayload(primitivesWithoutJsonView, unrenderedJsonbField(value));
    expect(capturedJsonView).toBeUndefined();
    expect(capturedText?.children).toBe(JSON.stringify(value));
    expect(capturedText?.variant).toBe("code");
  });
});
