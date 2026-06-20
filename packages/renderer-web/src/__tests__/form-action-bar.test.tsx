// shadcn-Form-Muster: die Action-Buttons sitzen als Footer am ENDE des
// Formulars (border-t-getrennt, rechtsbündig, im max-w-Body), NICHT mehr
// als Sticky-Bar im Header. Der Titel ist ein Heading oben. Strukturelle
// Assertions (Klassen/DOM) — der visuelle Beweis läuft über den Runner.

import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { DispatcherProvider, RenderEdit } from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "../primitives";
import { createMockDispatcher, render, screen } from "./test-utils";

const { Form, Section, Button } = defaultPrimitives;

describe("DefaultForm Action-Footer", () => {
  test("Actions sitzen rechtsbündig am Form-Ende (border-t), Titel ist Heading", () => {
    render(
      <Form onSubmit={() => {}} title="Titel" actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    const actions = screen.getByTestId("f-actions");
    expect(actions.className).toContain("justify-end");
    expect(actions.className).toContain("border-t");
    // Footer liegt im max-w-3xl-Form-Body (Buttons enden an der Feld-Linie).
    expect(actions.closest(".max-w-3xl")).toBeTruthy();
    // Titel ist ein eigenes Heading oben, NICHT mehr in der Action-Bar.
    expect(actions.textContent).not.toContain("Titel");
    expect(screen.getByTestId("f-title").textContent).toBe("Titel");
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

describe("Form = eine Card, Sections als innere Abschnitte", () => {
  test("Section im Form trägt keine eigene Card-Fläche, Titel+Footer leben in derselben Card", () => {
    render(
      <Form onSubmit={() => {}} title="Titel" actions={<Button>Save</Button>} testId="f">
        <Section testId="s1">
          <div>a</div>
        </Section>
        <Section testId="s2">
          <div>b</div>
        </Section>
      </Form>,
    );
    // Inner-Region: keine eigene bg-card; die Divider zwischen Sections
    // macht der divide-y-Wrapper, nicht die Section selbst.
    const s1 = screen.getByTestId("s1");
    expect(s1.className).not.toContain("bg-card");
    expect(s1.closest(".divide-y")).toBeTruthy();
    // Das Form wrappt alles in GENAU eine Card-Fläche.
    const card = screen.getByTestId("f").querySelector(".bg-card");
    expect(card).toBeTruthy();
    expect(card?.querySelectorAll(".bg-card").length).toBe(0);
    // Titel + Action-Footer sitzen in dieser Card.
    expect(card?.querySelector("[data-testid='f-title']")).toBeTruthy();
    expect(card?.querySelector("[data-testid='f-actions']")).toBeTruthy();
  });

  test("Section standalone (außerhalb Form) bleibt eine eigene Card", () => {
    render(
      <Section testId="solo" title="Solo">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("solo").className).toContain("bg-card");
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
