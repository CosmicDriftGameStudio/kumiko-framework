// An embedded list whose label repeats its section title prints the title once:
// the field label stays in the DOM for screen readers only.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

function schemaWithSectionTitle(sectionTitle: string): FeatureSchema {
  const screenDef: ActionFormScreenDefinition = {
    id: "receive",
    type: "actionForm",
    handler: "demo:write:receive",
    fields: {
      lines: { type: "embedded", multiple: true, schema: { text: { type: "text" } } },
    },
    layout: { sections: [{ title: sectionTitle, columns: 1, fields: ["lines"] }] },
  };
  return { featureName: "demo", entities: {}, screens: [screenDef] };
}

const TEXTS: Readonly<Record<string, string>> = {
  "demo.section.same": "Positionen",
  "demo.section.other": "Rechnungsinhalt",
};

// The field label of an actionForm field is the humanized key when untranslated,
// so the lookup returns "Positionen" for the one label key the form resolves.
function translate(key: string): string {
  if (TEXTS[key] !== undefined) return TEXTS[key];
  return key.endsWith("lines") ? "Positionen" : key;
}

function mount(sectionTitle: string): void {
  render(
    <DispatcherProvider dispatcher={createMockDispatcher()}>
      <NavProvider
        value={{
          route: { screenId: "demo:screen:receive" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "#",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={schemaWithSectionTitle(sectionTitle)}
          qn="demo:screen:receive"
          translate={translate}
        />
      </NavProvider>
    </DispatcherProvider>,
  );
}

function fieldLabel(): HTMLElement {
  const label = screen.getByTestId("field-lines").querySelector("label");
  if (label === null) throw new Error("no label in field-lines");
  return label;
}

describe("embedded list label next to the section title", () => {
  test("is screen-reader only when it equals the section title", async () => {
    mount("demo.section.same");
    await waitFor(() => expect(screen.getByTestId("field-lines")).toBeDefined());
    expect(fieldLabel().textContent).toContain("Positionen");
    expect(fieldLabel().className).toContain("sr-only");
  });

  test("stays visible when the section title differs", async () => {
    mount("demo.section.other");
    await waitFor(() => expect(screen.getByTestId("field-lines")).toBeDefined());
    expect(fieldLabel().textContent).toContain("Positionen");
    expect(fieldLabel().className).not.toContain("sr-only");
  });
});
