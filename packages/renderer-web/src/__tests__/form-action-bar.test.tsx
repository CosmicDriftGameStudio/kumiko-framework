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
import { BareFormProvider, defaultPrimitives } from "../primitives";
import { createMockDispatcher, render, screen } from "./test-utils";

const { Form, Section, Button } = defaultPrimitives;

describe("DefaultForm Action-Footer", () => {
  test("Actions sitzen am Form-Ende (border-t, sm:justify-between), Titel ist Heading", () => {
    render(
      <Form onSubmit={() => {}} title="Titel" actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    const actions = screen.getByTestId("f-actions");
    // The border/layout classes live on the outer footer container (which
    // also wraps the optional secondaryActions group), not on the inner
    // `-actions` div itself.
    const footer = actions.parentElement as HTMLElement;
    expect(footer.className).toContain("sm:justify-between");
    expect(footer.className).toContain("border-t");
    // Footer sits in the form shell (buttons align with the field edge).
    expect(actions.closest(".max-w-full")).toBeTruthy();
    // Title is its own heading above — not inside the action bar.
    expect(actions.textContent).not.toContain("Titel");
    expect(screen.getByTestId("f-title").textContent).toBe("Titel");
  });

  test("secondaryActions + actions: zwei Gruppen mit eigenen testIds, Container flex-col-reverse", () => {
    render(
      <Form
        onSubmit={() => {}}
        actions={<Button>Save</Button>}
        secondaryActions={<Button variant="danger-ghost">Delete</Button>}
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
    const secondary = screen.getByTestId("f-actions-secondary");
    const main = screen.getByTestId("f-actions");
    expect(secondary.textContent).toBe("Delete");
    expect(main.textContent).toBe("Save");
    // Same outer footer container wraps both groups.
    expect(secondary.parentElement).toBe(main.parentElement);
    const footer = main.parentElement as HTMLElement;
    expect(footer.className).toContain("flex-col-reverse");
    expect(footer.className).toContain("sm:justify-between");
  });

  test("nur actions (keine secondaryActions): keine -actions-secondary-Gruppe", () => {
    render(
      <Form onSubmit={() => {}} actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    expect(screen.queryByTestId("f-actions-secondary")).toBeNull();
    expect(screen.getByTestId("f-actions").textContent).toBe("Save");
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
    // Inner-Region: keine eigene bg-card; beide Sections sind Geschwister im
    // selben Body-Wrapper (der die Trennlinie ZWISCHEN ihnen per CSS macht).
    const s1 = screen.getByTestId("s1");
    const s2 = screen.getByTestId("s2");
    expect(s1.className).not.toContain("bg-card");
    expect(s1.parentElement).toBe(s2.parentElement);
    // Das Form wrappt alles in GENAU eine Card-Fläche.
    const card = screen.getByTestId("f").querySelector(".bg-card");
    expect(card).toBeTruthy();
    expect(card?.querySelectorAll(".bg-card").length).toBe(0);
    // Titel + Action-Footer sitzen in dieser Card.
    expect(card?.querySelector("[data-testid='f-title']")).toBeTruthy();
    expect(card?.querySelector("[data-testid='f-actions']")).toBeTruthy();
  });

  test("BareFormProvider: Form rendert nackt (keine eigene Card) — gegen Card-in-Card im AuthCard", () => {
    render(
      <BareFormProvider>
        <Form onSubmit={() => {}} testId="bare">
          <div>a</div>
        </Form>
      </BareFormProvider>,
    );
    const form = screen.getByTestId("bare");
    expect(form.tagName).toBe("FORM");
    expect(form.className).not.toContain("max-w-3xl");
    expect(form.querySelector(".bg-card")).toBeNull();
    expect(form.className).toContain("gap-4");
  });

  test("BareFormProvider: sections get the divider rule between them", () => {
    render(
      <BareFormProvider>
        <Form onSubmit={() => {}} testId="bare-sections">
          <Section testId="s1">
            <div>a</div>
          </Section>
          <Section testId="s2">
            <div>b</div>
          </Section>
        </Form>
      </BareFormProvider>,
    );
    const form = screen.getByTestId("bare-sections");
    // jsdom doesn't run Tailwind's JIT, so `:not(:first-child)` can't be
    // asserted via computed style — check the structural precondition the
    // selector relies on (both sections are direct <form> children, in
    // order) plus the divider utility class carrying it.
    const sectionChildren = Array.from(form.children).filter((el) => el.tagName === "SECTION");
    expect(sectionChildren.length).toBe(2);
    expect(sectionChildren[0]).toBe(screen.getByTestId("s1"));
    expect(sectionChildren[1]).toBe(screen.getByTestId("s2"));
    expect(form.className).toContain("[&>section:not(:first-child)]:border-t");
  });

  test("BareFormProvider: flat AuthCard-shaped fields render no <section> — the divider rule stays inert", () => {
    render(
      <BareFormProvider>
        <Form onSubmit={() => {}} testId="bare-flat">
          <div>field one</div>
          <div>field two</div>
        </Form>
      </BareFormProvider>,
    );
    const form = screen.getByTestId("bare-flat");
    expect(form.querySelectorAll("section").length).toBe(0);
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

describe("DefaultSection Card-Standard (subtitle + actions-Footer)", () => {
  test("standalone: subtitle rendert muted, KEIN Divider unterm Titel", () => {
    render(
      <Section testId="sc" title="Ergebnis" subtitle="Kontext-Zeile">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("sc-subtitle").textContent).toBe("Kontext-Zeile");
    expect(screen.getByTestId("sc-subtitle").className).toContain("text-muted-foreground");
    // border-b-Header (alt) ist weg — Titel fließt in den Body (shadcn-Muster).
    expect(screen.getByTestId("sc").querySelector(".border-b")).toBeNull();
  });

  test("standalone: actions = abgehobene Footer-Row (border-t)", () => {
    render(
      <Section testId="sc" title="Ergebnis" actions={<Button>Übernehmen</Button>}>
        <div>x</div>
      </Section>,
    );
    const actions = screen.getByTestId("sc-actions");
    expect(actions.className).toContain("border-t");
    expect(actions.className).toContain("justify-end");
    expect(actions.textContent).toContain("Übernehmen");
  });

  test('standalone: variant="destructive" adds a destructive border, default variant does not', () => {
    render(
      <Section testId="danger" title="Danger zone" variant="destructive">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("danger").className).toContain("border-destructive/40");
  });

  test("title-only standalone (Bestands-Consumer) hat keinen Divider mehr", () => {
    render(
      <Section testId="legacy" title="Stammdaten">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("legacy").querySelector(".border-b")).toBeNull();
  });

  test("im Form: actions sind rechtsbündig OHNE border-t (das Form trägt den Footer)", () => {
    render(
      <Form onSubmit={() => {}} testId="f">
        <Section testId="inner" actions={<Button>X</Button>}>
          <div>x</div>
        </Section>
      </Form>,
    );
    const actions = screen.getByTestId("inner-actions");
    expect(actions.className).toContain("justify-end");
    expect(actions.className).not.toContain("border-t");
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
