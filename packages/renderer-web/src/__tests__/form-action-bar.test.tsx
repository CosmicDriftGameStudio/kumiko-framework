// F2.4 (Bug-Bash-2): Die Sticky-Action-Bar spannte die volle Breite,
// während der Form-Body auf max-w-2xl begrenzt ist — die Buttons
// klebten am Fensterrand, optisch abgekoppelt vom Formular. Außerdem
// wiederholte der Section-Header bei Single-Section-ActionForms den
// Screen-Titel 1:1. Strukturelle Assertions (Klassen/DOM) — der
// visuelle Beweis läuft über die publicstatus-Screens nach dem Bump.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { DispatcherProvider, RenderEdit } from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "../primitives";
import { createMockDispatcher, render, screen } from "./test-utils";

const { Form, Section, Button } = defaultPrimitives;

describe("DefaultForm Action-Bar", () => {
  test("Bar-Inhalt aligned mit dem Form-Body (max-w-Container in der Bar)", () => {
    render(
      <Form onSubmit={() => {}} title="Titel" actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    const bar = screen.getByTestId("f-actions");
    const inner = bar.firstElementChild;
    expect(inner).toBeTruthy();
    // Gleiche Breiten-Constraint wie der Body (max-w-2xl + px-6) — die
    // Buttons enden damit an derselben Linie wie die Formularfelder.
    expect(inner?.className).toContain("max-w-2xl");
    expect(inner?.className).toContain("px-6");
  });
});

describe("DefaultSection ohne Titel", () => {
  test("rendert keinen leeren Header", () => {
    render(
      <Section testId="s">
        <div>content</div>
      </Section>,
    );
    expect(screen.getByTestId("s").querySelector("h3")).toBeNull();
  });
});

const orderEntity = {
  fields: { title: { type: "text", required: true } },
} as unknown as EntityDefinition; // @cast-boundary test-fixture

function makeScreen(sectionTitle: string): EntityEditScreenDefinition {
  return {
    id: "orders:screen:order-edit",
    type: "entityEdit",
    entity: "order",
    layout: { sections: [{ title: sectionTitle, columns: 1, fields: ["title"] }] },
  };
}

describe("RenderEdit Section-Titel-Dopplung", () => {
  test("Section-Titel == Form-Titel → Header unterdrückt", () => {
    // Ohne translate-Bundle fällt der Form-Titel auf screen.id zurück —
    // ein gleichlautender Section-Titel reproduziert die Dopplung.
    render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <RenderEdit
          screen={makeScreen("orders:screen:order-edit")}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "" }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    const section = screen.getByTestId("section-orders:screen:order-edit");
    expect(section.querySelector("h3")).toBeNull();
  });

  test("abweichender Section-Titel bleibt sichtbar", () => {
    render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <RenderEdit
          screen={makeScreen("Basics")}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "" }}
          writeCommand="order:create"
        />
      </DispatcherProvider>,
    );
    const section = screen.getByTestId("section-Basics");
    expect(section.querySelector("h3")?.textContent).toBe("Basics");
  });
});
