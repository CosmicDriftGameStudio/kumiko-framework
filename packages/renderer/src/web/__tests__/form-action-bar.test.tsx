// shadcn form pattern: action buttons sit in a footer at the END of the
// form (separated by border-t, right-aligned, within the max-w body), NOT
// as a sticky bar in the header. The title is a heading above. Structural
// assertions (classes/DOM) — the visual proof runs through the test runner.

import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useState } from "react";
import { DispatcherProvider, FOOTER_ACTION_ROLE_PROP, RenderEdit } from "../../index.ts";
import { BareFormProvider, defaultPrimitives } from "../primitives/index.tsx";
import {
  createMockDispatcher,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  waitFor,
} from "./test-utils.tsx";

const { Form, Section, Button } = defaultPrimitives;

describe("DefaultForm Action-Footer", () => {
  test("Actions sit at the end of the form (border-t, sm:justify-between), title is a heading", () => {
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
    expect(actions.closest(".max-w-4xl")).toBeTruthy();
    // Title is its own heading above — not inside the action bar.
    expect(actions.textContent).not.toContain("Titel");
    expect(screen.getByTestId("f-title").textContent).toBe("Titel");
  });

  test("secondaryActions + actions: two groups with their own testIds, container flex-col-reverse", () => {
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
    // Link-variant secondary buttons are h-auto, so the group enforces the
    // same mobile touch-target height as the primary group.
    expect(secondary.className).toContain("max-sm:[&_button]:min-h-11");
    expect(main.textContent).toBe("Save");
    // Same outer footer container wraps both groups.
    expect(secondary.parentElement).toBe(main.parentElement);
    const footer = main.parentElement as HTMLElement;
    expect(footer.className).toContain("flex-col-reverse");
    expect(footer.className).toContain("sm:justify-between");
  });

  test("only actions (no secondaryActions): no -actions-secondary group", () => {
    render(
      <Form onSubmit={() => {}} actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    expect(screen.queryByTestId("f-actions-secondary")).toBeNull();
    expect(screen.getByTestId("f-actions").textContent).toBe("Save");
  });

  test("only actions (no secondaryActions): group remains right-aligned (sm:ml-auto)", () => {
    render(
      <Form onSubmit={() => {}} actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    // justify-between on the footer only pushes the lone group to the edge
    // when there's a second flex child to push away from — with a single
    // child it falls back to flex-start, so the actions group needs its own
    // margin to stay right-aligned on desktop.
    expect(screen.getByTestId("f-actions").className).toContain("sm:ml-auto");
  });
});

describe("DefaultForm Action-Footer with stickyActions (Wizard, mobile fix)", () => {
  test("only the submit action remains max-sm:fixed — Back (type=button) moves to secondary", () => {
    render(
      <Form
        onSubmit={() => {}}
        actions={
          <>
            <Button type="button">Back</Button>
            <Button type="submit">Next</Button>
          </>
        }
        secondaryActions={<Button variant="danger-ghost">Cancel</Button>}
        stickyActions
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
    const primary = screen.getByTestId("f-actions");
    const secondary = screen.getByTestId("f-actions-secondary");
    expect(primary.textContent).toBe("Next");
    expect(secondary.textContent).toBe("CancelBack");
    expect(primary.className).toContain("max-sm:fixed");
    expect(secondary.className).not.toContain("max-sm:fixed");
  });

  test("without stickyActions, the previous arrangement remains unchanged (no fixed, Back stays with actions)", () => {
    render(
      <Form
        onSubmit={() => {}}
        actions={
          <>
            <Button type="button">Back</Button>
            <Button type="submit">Next</Button>
          </>
        }
        secondaryActions={<Button variant="danger-ghost">Cancel</Button>}
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
    const primary = screen.getByTestId("f-actions");
    const secondary = screen.getByTestId("f-actions-secondary");
    expect(primary.textContent).toBe("BackNext");
    expect(secondary.textContent).toBe("Cancel");
    expect(primary.className).not.toContain("max-sm:fixed");
  });

  test("stickyActions without secondaryActions: Back alone forms the secondary group", () => {
    render(
      <Form
        onSubmit={() => {}}
        actions={
          <>
            <Button type="button">Back</Button>
            <Button type="submit">Next</Button>
          </>
        }
        stickyActions
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
    expect(screen.getByTestId("f-actions").textContent).toBe("Next");
    expect(screen.getByTestId("f-actions-secondary").textContent).toBe("Back");
  });

  test("stickyActions without a submit action: all actions remain fixed instead of disappearing (regression)", () => {
    render(
      <Form
        onSubmit={() => {}}
        actions={<Button type="button">Only Button</Button>}
        stickyActions
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
    const primary = screen.getByTestId("f-actions");
    expect(primary.textContent).toBe("Only Button");
    expect(primary.className).toContain("max-sm:fixed");
    expect(screen.queryByTestId("f-actions-secondary")).toBeNull();
  });
});

describe("DefaultSection without a title", () => {
  test("does not render an empty header", () => {
    render(
      <Section testId="s">
        <div>content</div>
      </Section>,
    );
    expect(screen.getByTestId("s").querySelector("h3")).toBeNull();
  });
});

describe("Form = one Card, Sections as inner sections", () => {
  test("Section in Form has no own Card surface, title and footer live in the same Card", () => {
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
    // Inner region: no own bg-card; both sections are siblings in the same
    // body wrapper, which creates the divider BETWEEN them through CSS.
    const s1 = screen.getByTestId("s1");
    const s2 = screen.getByTestId("s2");
    expect(s1.className).not.toContain("bg-card");
    expect(s1.parentElement).toBe(s2.parentElement);
    // The form wraps everything in exactly one card surface.
    const card = screen.getByTestId("f").querySelector(".bg-card");
    expect(card).toBeTruthy();
    expect(card?.querySelectorAll(".bg-card").length).toBe(0);
    // The title and action footer are contained in this card.
    expect(card?.querySelector("[data-testid='f-title']")).toBeTruthy();
    expect(card?.querySelector("[data-testid='f-actions']")).toBeTruthy();
  });

  test("BareFormProvider: Form renders bare (no own Card) — prevents Card-in-Card in AuthCard", () => {
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

  test("BareFormProvider: headerRegion is rendered inside the form, before the fields", () => {
    render(
      <BareFormProvider>
        <Form
          onSubmit={() => {}}
          testId="bare-header"
          headerRegion={<div data-testid="bare-header-region">head</div>}
        >
          <div data-testid="bare-field">a</div>
        </Form>
      </BareFormProvider>,
    );
    const form = screen.getByTestId("bare-header");
    expect(form.querySelector("[data-testid='bare-header-region']")).not.toBeNull();
    expect(form.firstElementChild?.getAttribute("data-testid")).toBe("bare-header-region");
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

  test("standalone Section (outside Form) remains its own Card", () => {
    render(
      <Section testId="solo" title="Solo">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("solo").className).toContain("bg-card");
  });
});

describe("DefaultSection Card-Standard (subtitle + title-row actions)", () => {
  test("standalone: subtitle rendert muted, KEIN Divider unterm Titel", () => {
    render(
      <Section testId="sc" title="Ergebnis" subtitle="Kontext-Zeile">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("sc-subtitle").textContent).toBe("Kontext-Zeile");
    expect(screen.getByTestId("sc-subtitle").className).toContain("text-muted-foreground");
    // The border-b header is gone — the title flows into the body (shadcn pattern).
    expect(screen.getByTestId("sc").querySelector(".border-b")).toBeNull();
  });

  test("standalone: actions render at the top right in the title row, no footer", () => {
    render(
      <Section testId="sc" title="Ergebnis" actions={<Button>Übernehmen</Button>}>
        <div>x</div>
      </Section>,
    );
    const actions = screen.getByTestId("sc-actions");
    expect(actions.className).not.toContain("border-t");
    expect(actions.textContent).toContain("Übernehmen");
    expect(screen.getByTestId("sc").querySelector(".border-t")).toBeNull();
  });

  test("standalone without a title: actions alone still span the title row, right-aligned", () => {
    render(
      <Section testId="sc-no-title" actions={<Button>X</Button>}>
        <div>x</div>
      </Section>,
    );
    const actions = screen.getByTestId("sc-no-title-actions");
    expect(actions.textContent).toContain("X");
    expect(actions.className).toContain("ml-auto");
  });

  test('standalone: variant="destructive" adds a destructive border, default variant does not', () => {
    render(
      <Section testId="danger" title="Danger zone" variant="destructive">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("danger").className).toContain("border-destructive/40");
  });

  test("title-only standalone (existing consumer) no longer has a divider", () => {
    render(
      <Section testId="legacy" title="Stammdaten">
        <div>x</div>
      </Section>,
    );
    expect(screen.getByTestId("legacy").querySelector(".border-b")).toBeNull();
  });

  test("in Form: actions are in the title row WITHOUT border-t (the Form provides the footer)", () => {
    render(
      <Form onSubmit={() => {}} testId="f">
        <Section testId="inner" actions={<Button>X</Button>}>
          <div>x</div>
        </Section>
      </Form>,
    );
    const actions = screen.getByTestId("inner-actions");
    expect(actions.textContent).toContain("X");
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
  test("Section title == Form title → Header suppressed", () => {
    // Without a translation bundle, the form title falls back to screen.id —
    // a matching section title reproduces the duplication.
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

  test("different Section title remains visible", () => {
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

describe("DefaultForm pinned footer (fillHeight + stickyActions)", () => {
  test("footer is a sibling after the body, in flow (no max-sm:fixed, no spacer)", () => {
    render(
      <Form onSubmit={() => {}} fillHeight stickyActions actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    const primary = screen.getByTestId("f-actions");
    expect(primary.className).not.toContain("max-sm:fixed");
    const footer = primary.parentElement as HTMLElement;
    expect(footer.className).toContain("shrink-0");
    expect(footer.className).toContain("border-t");
    expect(footer.nextElementSibling).toBeNull();
    expect(footer.previousElementSibling?.textContent).toContain("body");
    expect(footer.querySelector('[aria-hidden="true"].h-20')).toBeNull();
  });

  test("stickyActions without fillHeight keeps the fixed mobile bar", () => {
    render(
      <Form onSubmit={() => {}} stickyActions actions={<Button>Save</Button>} testId="f">
        <div>body</div>
      </Form>,
    );
    expect(screen.getByTestId("f-actions").className).toContain("max-sm:fixed");
  });
});

function RendersNothing(): ReactNode {
  return null;
}

function ActionWithDialog(): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Löschen</Button>
      {open && <div role="alertdialog">Wirklich löschen?</div>}
    </>
  );
}

describe("DefaultForm pinned footer below sm", () => {
  restoreViewportWidthAfterEach();

  function renderNarrow(unsavedCount: number | undefined, withDiscard: boolean) {
    setViewportWidth(390);
    render(
      <Form
        onSubmit={() => {}}
        fillHeight
        stickyActions
        unsavedCount={unsavedCount}
        secondaryActions={withDiscard ? <Button>Verwerfen</Button> : undefined}
        actions={<Button type="submit">Speichern</Button>}
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
  }

  test("a dirty edit form shows one row: badge on the overflow trigger, discard inside, no unsaved text", async () => {
    renderNarrow(2, true);
    const bar = screen.getByTestId("f-actions");
    expect(bar.className).toContain("h-14");
    expect(screen.getByTestId("f-overflow-badge")).toBeTruthy();
    expect(screen.queryByTestId("f-unsaved")).toBeNull();
    expect(screen.getByText("Verwerfen").closest(".hidden")).not.toBeNull();
    expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeNull();
    await userEvent.click(screen.getByTestId("f-overflow"));
    const popover = screen.getByText("Verwerfen").closest("[data-state]") as HTMLElement;
    expect(popover.getAttribute("data-state")).toBe("open");
    expect(screen.getByText("Verwerfen").closest(".hidden")).toBeNull();
    expect(screen.getByTestId("f-overflow").getAttribute("aria-label")).toContain("2");
    expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  });

  test("a clean form has no badge", () => {
    renderNarrow(0, true);
    expect(screen.queryByTestId("f-overflow-badge")).toBeNull();
  });

  function narrowForm(secondaryActions: ReactNode) {
    return (
      <Form
        onSubmit={() => {}}
        fillHeight
        stickyActions
        unsavedCount={0}
        secondaryActions={secondaryActions}
        actions={<Button type="submit">Speichern</Button>}
        testId="f"
      >
        <div>body</div>
      </Form>
    );
  }

  test("the overflow trigger stays hidden until an overflow action is enabled", async () => {
    setViewportWidth(390);
    const { rerender } = render(narrowForm(<Button disabled>Verwerfen</Button>));
    expect(screen.getByTestId("f-overflow").className).toContain("hidden");
    rerender(narrowForm(<Button>Verwerfen</Button>));
    await waitFor(() => expect(screen.getByTestId("f-overflow").className).not.toContain("hidden"));
  });

  test("an overflow node that renders nothing keeps the trigger hidden", () => {
    setViewportWidth(390);
    render(narrowForm(<RendersNothing />));
    expect(screen.getByTestId("f-overflow").className).toContain("hidden");
  });

  test("Escape closes the surrounding drawer while the overflow popover is closed", async () => {
    setViewportWidth(390);
    const onOpenChange = mock((_open: boolean) => {});
    render(
      <DialogPrimitive.Root open onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content aria-describedby={undefined}>
            <DialogPrimitive.Title>Drawer</DialogPrimitive.Title>
            {narrowForm(<Button>Verwerfen</Button>)}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>,
    );
    await waitFor(() => expect(screen.getByTestId("f-overflow").className).not.toContain("hidden"));
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("opening the overflow focuses its first action", async () => {
    setViewportWidth(390);
    render(narrowForm(<Button>Verwerfen</Button>));
    await waitFor(() => expect(screen.getByTestId("f-overflow").className).not.toContain("hidden"));
    await userEvent.click(screen.getByTestId("f-overflow"));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Verwerfen"));
  });

  test("a dialog owned by an overflow action still opens and survives the popover closing", async () => {
    setViewportWidth(390);
    render(narrowForm(<ActionWithDialog />));
    await waitFor(() => expect(screen.getByTestId("f-overflow").className).not.toContain("hidden"));
    await userEvent.click(screen.getByTestId("f-overflow"));
    await userEvent.click(await screen.findByRole("button", { name: "Löschen" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  test("a lone primary action renders without an overflow trigger", () => {
    renderNarrow(undefined, false);
    expect(screen.queryByTestId("f-overflow")).toBeNull();
    expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  });

  test("a lone primary action with unsaved changes shows the badge and an accessible status", () => {
    renderNarrow(2, false);
    expect(screen.queryByTestId("f-overflow")).toBeNull();
    expect(screen.getByTestId("f-primary-badge")).toBeTruthy();
    const primary = screen.getByTestId("f-primary-badge").closest("button") as HTMLElement;
    expect(primary.textContent).toContain("Speichern");
    expect(primary.querySelector(".sr-only")?.textContent).toContain("2");
  });

  test("a clean lone primary action has no badge", () => {
    renderNarrow(0, false);
    expect(screen.queryByTestId("f-primary-badge")).toBeNull();
  });

  test("an explicit primary marker wins over a later submit button", () => {
    setViewportWidth(390);
    render(
      <Form
        onSubmit={() => {}}
        fillHeight
        stickyActions
        actions={
          <>
            <Button {...{ [FOOTER_ACTION_ROLE_PROP]: "primary" as const }}>Weiter</Button>
            <Button type="submit">Speichern und schließen</Button>
          </>
        }
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
    expect(screen.getByRole("button", { name: "Weiter" }).className).toContain("flex-1");
    expect(screen.getByRole("button", { name: "Speichern und schließen" }).className).not.toContain(
      "flex-1",
    );
  });

  function narrowFormWithBack(back: ReactNode) {
    setViewportWidth(390);
    render(
      <Form
        onSubmit={() => {}}
        fillHeight
        stickyActions
        actions={
          <>
            <Button {...{ [FOOTER_ACTION_ROLE_PROP]: "back" as const }}>{back}</Button>
            <Button type="submit">Speichern</Button>
          </>
        }
        testId="f"
      >
        <div>body</div>
      </Form>,
    );
  }

  test("Back with a string label collapses to a named icon button", () => {
    narrowFormWithBack("Zurück");
    const back = screen.getByRole("button", { name: "Zurück" });
    expect(back.textContent).toBe("");
    expect(back.getAttribute("aria-label")).toBe("Zurück");
  });

  test("Back without a determinable name stays a regular action in the overflow", () => {
    narrowFormWithBack(<span>Zurück</span>);
    const back = screen.getByText("Zurück").closest("button") as HTMLElement;
    expect(back.getAttribute("aria-label")).toBeNull();
    expect(back.textContent).toBe("Zurück");
    expect(screen.getByTestId("f-overflow")).toBeTruthy();
  });
});
