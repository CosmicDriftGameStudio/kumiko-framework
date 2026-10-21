// Default primitives for the web renderer. The tests pin the contract the
// renderer components (RenderEdit, RenderList, KumikoScreen) hand to the
// primitives: accessibility guarantees (role="alert" on error variants),
// event-shape mapping (Input returns a different JS type per kind instead of
// the raw ChangeEvent) and the testId forwarding the E2E tests depend on.

import { describe, expect, mock, test } from "bun:test";
import userEvent from "@testing-library/user-event";
import { defaultPrimitives, FormScreenShell, ScreenWidthProvider } from "../primitives/index.tsx";
import { DefaultJsonView } from "../primitives/json-view.tsx";
import { PageSection, Stack } from "../primitives/layout.tsx";
import {
  Banner,
  Button,
  Card,
  Dialog,
  Field,
  Form,
  Heading,
  Input,
  paddingOf,
  Section,
  Text,
} from "./_primitives-helpers.tsx";
import { fireEvent, render, screen, waitFor } from "./test-utils.tsx";

describe("Button", () => {
  test("expanded is forwarded as aria-expanded", () => {
    render(
      <>
        <Button expanded testId="open">
          A
        </Button>
        <Button expanded={false} testId="closed">
          B
        </Button>
        <Button testId="plain">C</Button>
      </>,
    );
    expect(screen.getByTestId("open").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("closed").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("plain").hasAttribute("aria-expanded")).toBe(false);
  });

  test("pressed sets aria-pressed and a visible pressed style; unpressed buttons carry neither", () => {
    render(
      <>
        <Button pressed variant="secondary" testId="on">
          A
        </Button>
        <Button pressed={false} variant="secondary" testId="off">
          B
        </Button>
      </>,
    );
    const on = screen.getByTestId("on");
    const off = screen.getByTestId("off");
    expect(on.getAttribute("aria-pressed")).toBe("true");
    expect(on.className).toContain("bg-accent");
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.className).not.toContain("ring-primary/30");
  });

  test("disabled: attribute gesetzt + Tailwind-Klassen für pointer-events/opacity", () => {
    render(
      <Button disabled testId="btn">
        Save
      </Button>,
    );
    const btn = screen.getByTestId("btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Visuelles Feedback kommt aus Tailwind-Klassen (shadcn-Pattern).
    expect(btn.className).toContain("disabled:pointer-events-none");
    expect(btn.className).toContain("disabled:opacity-50");
  });

  test("onClick fires on click", () => {
    const onClick = mock();
    render(
      <Button onClick={onClick} testId="btn">
        Go
      </Button>,
    );
    fireEvent.click(screen.getByTestId("btn"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("loading: Spinner ersetzt icon-Slot, Children bleiben sichtbar (kein Width-Jump) + ist disabled", () => {
    const onClick = mock();
    render(
      <Button loading onClick={onClick} testId="btn">
        Save
      </Button>,
    );
    const btn = screen.getByTestId("btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.dataset["loading"]).toBe("true");
    expect(btn.textContent).toContain("Save");
    expect(btn.querySelector("svg")).not.toBeNull();
  });

  test("icon: rendert ein SVG vor dem Label, kein SVG ohne icon-Prop", () => {
    render(
      <Button icon="trash" testId="btn">
        Delete
      </Button>,
    );
    const btn = screen.getByTestId("btn") as HTMLButtonElement;
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(btn.textContent).toBe("Delete");
    // The icon sits before the label text node in DOM order.
    expect(svg?.compareDocumentPosition(btn.lastChild as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    render(<Button testId="btn-no-icon">Delete</Button>);
    expect(screen.getByTestId("btn-no-icon").querySelector("svg")).toBeNull();
  });

  test("iconEnd: rendert ein SVG nach dem Label", () => {
    render(
      <Button iconEnd="arrow-right" testId="btn">
        Next
      </Button>,
    );
    const btn = screen.getByTestId("btn") as HTMLButtonElement;
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(btn.textContent).toBe("Next");
    expect(btn.firstChild).not.toBe(svg);
    expect(btn.lastChild).toBe(svg);
  });

  test("danger-ghost: destruktiv eingefärbt, normales ghost nicht", () => {
    render(
      <>
        <Button variant="danger-ghost" testId="danger">
          Delete
        </Button>
        <Button variant="ghost" testId="neutral">
          Cancel
        </Button>
      </>,
    );
    expect(screen.getByTestId("danger").className).toContain("text-destructive");
    expect(screen.getByTestId("neutral").className).not.toContain("text-destructive");
  });
});

describe("Banner", () => {
  test('variant="error" sets role="alert" (a11y)', () => {
    render(
      <Banner variant="error" testId="b">
        Something broke
      </Banner>,
    );
    expect(screen.getByTestId("b").getAttribute("role")).toBe("alert");
  });

  test('variant="info" has no alert role', () => {
    render(
      <Banner variant="info" testId="b">
        Hi
      </Banner>,
    );
    expect(screen.getByTestId("b").getAttribute("role")).toBeNull();
  });

  test("actions prop renders in actions slot", () => {
    render(
      <Banner variant="info" testId="b" actions={<span>undo</span>}>
        Saved
      </Banner>,
    );
    const slot = screen.getByTestId("b").querySelector('[data-slot="actions"]');
    expect(slot?.textContent).toBe("undo");
  });

  test("title renders bold above children with its own testId", () => {
    render(
      <Banner variant="info" testId="b" title="Settings changed" titleTestId="b-title">
        Regenerate to apply
      </Banner>,
    );
    const title = screen.getByTestId("b-title");
    expect(title.textContent).toBe("Settings changed");
    expect(title.className).toContain("font-semibold");
    expect(screen.getByTestId("b").textContent).toBe("Settings changedRegenerate to apply");
  });

  test('variant="primary" has a primary left accent, neutral background and an actions slot', () => {
    render(
      <Banner variant="primary" testId="b" title="3 posts have no text" actions={<span>Go</span>}>
        Generate them now
      </Banner>,
    );
    const banner = screen.getByTestId("b");
    expect(banner.getAttribute("data-variant")).toBe("primary");
    expect(banner.className).toContain("border-l-primary");
    expect(banner.className).toContain("bg-card");
    expect(banner.className).toContain("sm:flex-row");
    expect(banner.getAttribute("role")).toBeNull();
    expect(banner.querySelector('[data-slot="actions"]')?.textContent).toBe("Go");
  });

  test("existing variants render without title wrapper or primary classes", () => {
    render(
      <Banner variant="info" testId="b">
        Hi
      </Banner>,
    );
    const banner = screen.getByTestId("b");
    expect(banner.className).not.toContain("border-l-primary");
    expect(banner.querySelector(".font-semibold")).toBeNull();
    expect(banner.innerHTML).toBe('<div class="flex-1">Hi</div>');
  });

  test("id prop (Field-as-control usage) sets role=group + aria-labelledby, not a bare id/htmlFor pairing", () => {
    render(
      <Field id="unsupported-field" label="Raw data">
        <Banner id="unsupported-field" variant="info" testId="b">
          No editor for this field type
        </Banner>
      </Field>,
    );
    const banner = screen.getByTestId("b");
    expect(banner.getAttribute("role")).toBe("group");
    const labelledBy = banner.getAttribute("aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(document.getElementById(labelledBy ?? "")?.textContent).toContain("Raw data");
  });
});

describe("Field", () => {
  test("required fügt einen Stern ans Label an", () => {
    render(
      <Field id="f1" label="Name" required testId="f">
        <input />
      </Field>,
    );
    // shadcn-Field rendert den Mark als <span>* mit text-destructive.
    const label = screen.getByTestId("f").querySelector("label");
    expect(label?.textContent).toContain("*");
  });

  test("issues render inside role=alert with per-testId suffix", () => {
    render(
      <Field
        id="f1"
        label="Email"
        testId="f"
        issues={[{ path: "email", code: "invalid", i18nKey: "Email invalid" }]}
      >
        <input />
      </Field>,
    );
    const alert = screen.getByTestId("f-errors");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Email invalid");
  });

  test("no issues → no alert element", () => {
    render(
      <Field id="f1" label="Email" testId="f">
        <input />
      </Field>,
    );
    expect(screen.queryByTestId("f-errors")).toBeNull();
  });
});

describe("Input kind mapping", () => {
  test('kind="text": onChange receives string', () => {
    const onChange = mock();
    render(<Input id="i" name="i" kind="text" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  test('kind="number": "" → undefined, numeric → number', () => {
    const onChange = mock();
    render(<Input id="i" name="i" kind="number" value={0} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenLastCalledWith(42);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  test('kind="boolean" outside layout="inline": renders a switch, onChange receives checked', () => {
    const onChange = mock();
    render(<Input id="i" name="i" kind="boolean" value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('kind="date": tippbares Text-Input mit locale-Datum, kein nativer date-Input', () => {
    // Default-DateInput nutzt seit #369 ein tippbares Text-Input +
    // DayPicker-Popover statt native <input type="date">. Das Datum steht
    // locale-numerisch im Eingabefeld.
    const onChange = mock();
    render(
      <Input id="i" name="i" kind="date" value="2026-04-23" onChange={onChange} locale="de-DE" />,
    );
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("23.04.2026");
  });

  test("hasError=true sets aria-invalid", () => {
    render(<Input id="i" name="i" kind="text" value="" hasError onChange={() => {}} />);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
  });

  test('kind="text" icon="mail": renders prefix icon + pads the input', () => {
    render(<Input id="i" name="i" kind="text" value="" icon="mail" onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("pl-8");
    expect(document.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  test('kind="text" icon="not-a-real-key": unknown key → no icon, no padding', () => {
    render(
      <Input
        id="i"
        name="i"
        kind="text"
        value=""
        icon={
          "not-a-real-key" as unknown as import("@cosmicdrift/kumiko-framework/ui-types").FieldIconKey
        }
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input.className).not.toContain("pl-8");
    expect(document.querySelector("svg[aria-hidden='true']")).toBeNull();
  });

  test('kind="text" icon="constructor": prototype-chain key → no icon, no padding', () => {
    render(
      <Input
        id="i"
        name="i"
        kind="text"
        value=""
        icon={
          "constructor" as unknown as import("@cosmicdrift/kumiko-framework/ui-types").FieldIconKey
        }
        onChange={() => {}}
      />,
    );
    const input = screen.getByRole("textbox");
    expect(input.className).not.toContain("pl-8");
    expect(document.querySelector("svg[aria-hidden='true']")).toBeNull();
  });

  test('kind="number" icon="hash": renders prefix icon and keeps the value left-aligned', () => {
    render(<Input id="i" name="i" kind="number" value={0} icon="hash" onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("pl-8");
    expect(input.className).toContain("text-left");
    expect(input.className).toContain("tabular-nums");
    expect(input.className).not.toContain("text-right");
    expect(document.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  test('kind="number" unit="km": renders a muted suffix inside the field, pads the input and exposes the unit as its description', () => {
    render(<Input id="i" name="i" kind="number" value={58} unit="km" onChange={() => {}} />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("pr-8");
    const suffix = screen.getByText("km");
    expect(suffix.getAttribute("aria-hidden")).toBeNull();
    expect(suffix.id).toBe("i-unit");
    expect(input.getAttribute("aria-describedby")).toBe("i-unit");
    expect((input as HTMLInputElement).value).toBe("58");
  });

  test('kind="number" icon="hash" unit="km": icon, input and unit share one number-field box', () => {
    render(
      <Input id="i" name="i" kind="number" value={58} icon="hash" unit="km" onChange={() => {}} />,
    );
    const box = screen.getByRole("textbox").parentElement;
    expect(box?.getAttribute("data-slot")).toBe("number-field");
    expect(screen.getByText("km").parentElement).toBe(box ?? null);
    expect(box?.querySelector("svg[aria-hidden='true']")?.parentElement).toBe(box ?? null);
  });

  test('kind="number" without unit: no suffix rendered, no right padding', () => {
    render(<Input id="i" name="i" kind="number" value={58} onChange={() => {}} />);
    expect(screen.queryByText("km")).toBeNull();
    expect(screen.getByRole("textbox").className).not.toContain("pr-8");
  });

  test('kind="number" unit="km": typing only changes the numeric value, the unit never enters it', () => {
    const onChange = mock();
    render(<Input id="i" name="i" kind="number" value={58} unit="km" onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "120" } });
    expect(onChange).toHaveBeenCalledWith(120);
  });

  test('kind="number" icon="hash" unit="km": both decorations render without clobbering each other', () => {
    render(
      <Input id="i" name="i" kind="number" value={58} icon="hash" unit="km" onChange={() => {}} />,
    );
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("pl-8");
    expect(input.className).toContain("pr-8");
    expect(document.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByText("km").id);
  });
});

// Boolean fields render a switch inside a standard (stacked) Field — matching
// every other field's label-above-control arrangement — while layout="inline"
// Fields (MultiSelectCheckboxes, the BooleanField widget) keep the checkbox.
describe("Input kind=boolean: switch vs checkbox", () => {
  test("Field (default layout) + Input(boolean): renders role=switch, not checkbox", () => {
    render(
      <Field id="active" label="Active" testId="field-active">
        <Input id="active" name="active" kind="boolean" value={false} onChange={mock()} />
      </Field>,
    );
    const field = screen.getByTestId("field-active");
    expect(field.querySelector('[role="switch"]')).toBeTruthy();
    expect(field.querySelector('[role="checkbox"]')).toBeNull();
  });

  test("Field(layout=inline) + Input(boolean): keeps the checkbox", () => {
    render(
      <Field id="opt" label="Option A" layout="inline" testId="field-opt">
        <Input id="opt" name="opt" kind="boolean" value={false} onChange={mock()} />
      </Field>,
    );
    const field = screen.getByTestId("field-opt");
    expect(field.querySelector('[role="checkbox"]')).toBeTruthy();
    expect(field.querySelector('[role="switch"]')).toBeNull();
  });

  test("clicking the switch reports the inverted value to onChange", () => {
    const onChange = mock();
    render(<Input id="active" name="active" kind="boolean" value={true} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test("aria-checked reflects the value, and the switch toggles via keyboard", async () => {
    const onChange = mock();
    const { rerender } = render(
      <Input id="active" name="active" kind="boolean" value={false} onChange={onChange} />,
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");

    rerender(<Input id="active" name="active" kind="boolean" value={true} onChange={onChange} />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");

    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("switch"));
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test("disabled prevents toggling", () => {
    const onChange = mock();
    render(
      <Input id="active" name="active" kind="boolean" value={false} onChange={onChange} disabled />,
    );
    const toggle = screen.getByRole("switch") as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("boolean field's label sits above the control, same as a text field's", () => {
    render(
      <>
        <Field id="active" label="Active" testId="field-active">
          <Input id="active" name="active" kind="boolean" value={false} onChange={mock()} />
        </Field>
        <Field id="title" label="Title" testId="field-title">
          <Input id="title" name="title" kind="text" value="" onChange={mock()} />
        </Field>
      </>,
    );

    const booleanField = screen.getByTestId("field-active");
    const textField = screen.getByTestId("field-title");

    // Same structural shape: label-row first, control second — the exact
    // regression the old inline-layout checkbox introduced for booleans.
    expect(booleanField.children[0]?.querySelector("label")).toBeTruthy();
    expect(booleanField.children[1]?.getAttribute("role")).toBe("switch");
    expect(textField.children[0]?.querySelector("label")).toBeTruthy();
    expect(textField.children[1]?.tagName).toBe("INPUT");
  });
});

describe("Form", () => {
  test("submit calls onSubmit and prevents default navigation", () => {
    const onSubmit = mock();
    render(
      <Form onSubmit={onSubmit} testId="form">
        <button type="submit">Go</button>
      </Form>,
    );
    const form = screen.getByTestId("form") as HTMLFormElement;
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    fireEvent(form, submitEvent);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitEvent.defaultPrevented).toBe(true);
  });

  test("title rendert als Heading oben, Actions als Footer am Ende", () => {
    render(
      <Form
        onSubmit={() => undefined}
        title="Eintrag bearbeiten"
        actions={<button type="submit">Save</button>}
        testId="form"
      >
        <div>content</div>
      </Form>,
    );
    expect(screen.getByTestId("form-title").textContent).toContain("Eintrag bearbeiten");
    const actionsFooter = screen.getByTestId("form-actions");
    expect(actionsFooter.textContent).toContain("Save");
    // Titel ist NICHT mehr in der Action-Leiste (raus aus dem Header).
    expect(actionsFooter.textContent).not.toContain("Eintrag bearbeiten");
  });

  test("ohne title und actions: keine Action-Bar gerendert", () => {
    render(
      <Form onSubmit={() => undefined} testId="form">
        <div>content</div>
      </Form>,
    );
    expect(screen.queryByTestId("form-actions")).toBeNull();
  });

  test("stickyActions: nur die primäre Action-Gruppe bekommt mobile-fixed-Klassen (fw#1918, fw#2606 follow-up)", () => {
    render(
      <Form
        onSubmit={() => undefined}
        actions={<button type="submit">Next</button>}
        testId="form"
        stickyActions
      >
        <div>content</div>
      </Form>,
    );
    const actionsFooter = screen.getByTestId("form-actions");
    // stickyActions classes now live on the primary-actions group itself —
    // only the submit action stays pinned above a virtual keyboard; a Back
    // button or secondaryActions (Cancel/Delete/…) sit in normal flow via
    // form-actions-secondary instead (fw#2606: whole footer no longer
    // includes those on mobile).
    expect(actionsFooter.className).toContain("max-sm:fixed");
    const footer = actionsFooter.parentElement as HTMLElement;
    expect(footer.className).not.toContain("max-sm:fixed");
    const contentContainer = footer.previousElementSibling as HTMLElement;
    expect(contentContainer.className).toContain(
      "max-sm:pb-[calc(6rem_+_env(safe-area-inset-bottom))]",
    );
    expect(actionsFooter.className).toContain("max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]");
  });

  test("ohne stickyActions: Footer bleibt im normalen Dokumentfluss", () => {
    render(
      <Form onSubmit={() => undefined} actions={<button type="submit">Save</button>} testId="form">
        <div>content</div>
      </Form>,
    );
    const actionsFooter = screen.getByTestId("form-actions");
    const footer = actionsFooter.parentElement as HTMLElement;
    expect(footer.className).not.toContain("max-sm:fixed");
    const contentContainer = footer.previousElementSibling as HTMLElement;
    expect(contentContainer.className).not.toContain(
      "max-sm:pb-[calc(6rem_+_env(safe-area-inset-bottom))]",
    );
  });

  // fillHeight (fw#2722, height fw#2778): the flex chain RenderEdit opts a
  // lone relatedList tab into, so its table can scroll inside the tab panel
  // instead of the whole page stretching to the row count. The chain caps
  // at h-full but does NOT flex-1/grow past its content — a short table
  // must not stretch the card to the bottom of the panel (fw#2778); only
  // the innermost table wrapper (primitives.test.tsx's DataTable coverage)
  // keeps flex-1 to actually claim the leftover height once the ancestor
  // chain is force-shrunk.
  test("fillHeight: form root caps at h-full/min-h-0, its card sizes to content instead of growing (fw#2778)", () => {
    render(
      <Form onSubmit={() => undefined} testId="form" fillHeight>
        <div>content</div>
      </Form>,
    );
    const form = screen.getByTestId("form");
    expect(form.className).toContain("h-full");
    expect(form.className).toContain("min-h-0");
    // form > FormScreenShell > card(overflow-hidden) — the card sizes to
    // its content (no flex-1) and only shrinks (min-h-0) once the chain
    // above it is itself height-constrained.
    const card = form.firstElementChild?.firstElementChild as HTMLElement;
    expect(card.className).not.toContain("flex-1");
    expect(card.className).toContain("min-h-64");
  });

  test("fillHeight chromeless: the sections container holds the min-height floor", () => {
    render(
      <Form onSubmit={() => undefined} testId="form" fillHeight chromeless>
        <div data-testid="child">content</div>
      </Form>,
    );
    const sections = screen.getByTestId("child").parentElement as HTMLElement;
    expect(sections.className).toContain("min-h-64");
    expect(sections.className).not.toContain("min-h-0");
  });

  test("without fillHeight: no min-height floor on card or sections", () => {
    render(
      <Form onSubmit={() => undefined} testId="form">
        <div data-testid="child">content</div>
      </Form>,
    );
    const form = screen.getByTestId("form");
    const card = form.firstElementChild?.firstElementChild as HTMLElement;
    expect(card.className).not.toContain("min-h-");
    expect(screen.getByTestId("child").parentElement?.className).not.toContain("min-h-");
  });

  test("without fillHeight: form root keeps its normal, content-sized height", () => {
    render(
      <Form onSubmit={() => undefined} testId="form">
        <div>content</div>
      </Form>,
    );
    const form = screen.getByTestId("form");
    expect(form.className).not.toContain("h-full");
    const card = form.firstElementChild?.firstElementChild as HTMLElement;
    expect(card.className).not.toContain("flex-1");
  });
});

describe("Banner padded", () => {
  test("padded=true wraps in p-6 container für Page-State-Use", () => {
    const { container } = render(
      <Banner padded variant="info" testId="banner">
        Loading…
      </Banner>,
    );
    const banner = screen.getByTestId("banner");
    // Outer wrapper hat p-6, banner innen
    const wrapper = banner.parentElement;
    expect(wrapper?.className).toContain("p-6");
    expect(container.firstChild).toBe(wrapper);
  });

  test("padded=undefined rendert ohne Wrapper (inline-Use)", () => {
    const { container } = render(
      <Banner variant="info" testId="banner">
        Inline
      </Banner>,
    );
    expect(container.firstChild).toBe(screen.getByTestId("banner"));
  });
});

describe("Heading variants", () => {
  test('variant="page" renders h1', () => {
    render(
      <Heading variant="page" testId="h">
        Items
      </Heading>,
    );
    expect(screen.getByTestId("h").tagName).toBe("H1");
  });

  test('variant="section" renders h2 mit uppercase styling', () => {
    render(
      <Heading variant="section" testId="h">
        Basics
      </Heading>,
    );
    const h = screen.getByTestId("h");
    expect(h.tagName).toBe("H2");
    expect(h.className).toContain("uppercase");
  });
});

describe("Dialog", () => {
  test("open=true rendert Dialog mit Title und Confirm/Cancel Buttons", () => {
    const onConfirm = mock();
    const onOpenChange = mock();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Wirklich löschen?"
        onConfirm={onConfirm}
        testId="confirm"
      />,
    );
    expect(screen.getByText("Wirklich löschen?")).toBeTruthy();
    expect(screen.getByTestId("confirm-confirm")).toBeTruthy();
    expect(screen.getByTestId("confirm-cancel")).toBeTruthy();
  });

  test("open=false rendert nichts (Portal leer)", () => {
    render(
      <Dialog
        open={false}
        onOpenChange={() => undefined}
        title="Hidden"
        onConfirm={() => undefined}
        testId="hidden-dialog"
      />,
    );
    expect(screen.queryByTestId("hidden-dialog")).toBeNull();
  });

  test("Confirm-Button feuert onConfirm und schließt den Dialog", async () => {
    const user = userEvent.setup();
    const onConfirm = mock();
    const onOpenChange = mock();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Bestätigen?"
        onConfirm={onConfirm}
        testId="dlg"
      />,
    );
    // userEvent.click wartet auf React-State-Updates die durch Radix-
    // Lifecycle (Presence/FocusScope/DismissableLayer) ausgelöst werden
    // — fireEvent.click würde dieselben Updates uneingewickelt lassen
    // und mit ~13 act()-Warnings spammen.
    await user.click(screen.getByTestId("dlg-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("without children: initial focus lands on Confirm, and Enter there confirms (not Cancel)", async () => {
    const user = userEvent.setup();
    const onConfirm = mock();
    render(
      <Dialog
        open
        onOpenChange={() => undefined}
        title="Wirklich löschen?"
        onConfirm={onConfirm}
        testId="dlg"
      />,
    );
    const confirmButton = await waitFor(() => screen.getByTestId("dlg-confirm"));
    await waitFor(() => expect(document.activeElement).toBe(confirmButton));
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("with children: initial focus stays off Confirm (Radix default, e.g. an input inside)", async () => {
    render(
      <Dialog
        open
        onOpenChange={() => undefined}
        title="Details"
        onConfirm={() => undefined}
        testId="dlg-with-content"
      >
        <input type="text" data-testid="dlg-input" />
      </Dialog>,
    );
    const confirmButton = await waitFor(() => screen.getByTestId("dlg-with-content-confirm"));
    // No explicit assertion on where focus DOES land (Radix's own default,
    // out of scope here) — only that it isn't hijacked onto Confirm.
    expect(document.activeElement).not.toBe(confirmButton);
  });
});

describe("Text variants", () => {
  test('variant="code" renders <code>', () => {
    render(
      <Text variant="code" testId="t">
        x
      </Text>,
    );
    expect(screen.getByTestId("t").tagName).toBe("CODE");
  });

  test('variant="small" renders <small>', () => {
    render(
      <Text variant="small" testId="t">
        x
      </Text>,
    );
    expect(screen.getByTestId("t").tagName).toBe("SMALL");
  });

  test('variant="required-mark" renders data-required span', () => {
    render(
      <Text variant="required-mark" testId="t">
        *
      </Text>,
    );
    const el = screen.getByTestId("t");
    expect(el.tagName).toBe("SPAN");
    expect(el.hasAttribute("data-required")).toBe(true);
  });
});

describe("Card", () => {
  test("padded=true (default) adds body padding", () => {
    render(
      <Card testId="c">
        <span>body</span>
      </Card>,
    );
    expect(screen.getByTestId("c").innerHTML).toContain("p-[var(--card-padding)]");
  });

  test("framed=false drops the surface chrome but keeps padding and header", () => {
    render(
      <Card testId="c" options={{ framed: false }} slots={{ title: "Title" }}>
        <span>body</span>
      </Card>,
    );
    const className = screen.getByTestId("c").className;
    for (const chrome of ["border", "bg-card", "shadow", "rounded"]) {
      expect(className).not.toContain(chrome);
    }
    expect(screen.getByText("Title")).toBeDefined();
    expect(screen.getByTestId("c").innerHTML).toContain("pb-[var(--card-padding)]");
  });

  test("padded=false renders body without padding classes", () => {
    render(
      <Card testId="c" options={{ padded: false }}>
        <span>body</span>
      </Card>,
    );
    const bodyWrapper = screen.getByText("body").parentElement;
    expect(bodyWrapper?.className.includes("p-6")).toBe(false);
    expect(bodyWrapper?.className.includes("px-6")).toBe(false);
  });

  test("slots.title/subtitle render a default header", () => {
    render(<Card testId="c" slots={{ title: "Title", subtitle: "Subtitle" }} />);
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Subtitle")).toBeTruthy();
  });

  test("no header slots → no header row rendered", () => {
    render(
      <Card testId="c">
        <span>only body</span>
      </Card>,
    );
    // Header row carries "items-start justify-between" — absent means no header.
    expect(screen.getByTestId("c").innerHTML).not.toContain("justify-between");
  });

  test("slots.footer renders bordered by default", () => {
    render(<Card testId="c" slots={{ footer: <span>Footer</span> }} />);
    const footer = screen.getByText("Footer").parentElement;
    expect(footer?.className.includes("border-t")).toBe(true);
  });

  test("slots.footer false or null renders no footer bar", () => {
    const { container, rerender } = render(
      <Card testId="c" slots={{ footer: false }}>
        <span>body</span>
      </Card>,
    );
    expect(container.querySelector(".border-t")).toBeNull();
    expect(screen.getByTestId("c").innerHTML).not.toContain("justify-end");
    rerender(
      <Card testId="c" slots={{ footer: null }}>
        <span>body</span>
      </Card>,
    );
    expect(screen.getByTestId("c").innerHTML).not.toContain("justify-end");
  });

  test("footerBordered=false drops the border", () => {
    render(
      <Card
        testId="c"
        slots={{ footer: <span>Footer</span> }}
        options={{ footerBordered: false }}
      />,
    );
    const footer = screen.getByText("Footer").parentElement;
    expect(footer?.className.includes("border-t")).toBe(false);
  });

  test("footer is inset by default and footerInset=false drops the horizontal padding", () => {
    const { unmount } = render(<Card testId="c" slots={{ footer: <span>Footer</span> }} />);
    expect(screen.getByText("Footer").parentElement?.className).toContain(
      "px-[var(--card-padding)]",
    );
    unmount();
    render(
      <Card testId="c" slots={{ footer: <span>Footer</span> }} options={{ footerInset: false }} />,
    );
    const footer = screen.getByText("Footer").parentElement;
    expect(footer?.className).not.toContain("px-");
    expect(footer?.className).toContain("py-4");
  });

  test('radius="lg" uses rounded-lg instead of rounded-xl', () => {
    render(
      <Card testId="c" options={{ radius: "lg" }}>
        x
      </Card>,
    );
    const el = screen.getByTestId("c");
    expect(el.className.includes("rounded-lg")).toBe(true);
    expect(el.className.includes("rounded-xl")).toBe(false);
  });

  test("children=undefined → no body wrapper rendered", () => {
    render(<Card testId="c" slots={{ title: "Only header" }} />);
    expect(screen.getByTestId("c").querySelectorAll("div").length).toBeGreaterThan(0);
    expect(screen.getByTestId("c").innerHTML).not.toContain("grow");
  });

  test("children=null (explicit, e.g. `cond ? <X/> : null`) → no body wrapper rendered either", () => {
    render(
      <Card testId="c" slots={{ title: "Only header" }}>
        {null}
      </Card>,
    );
    expect(screen.getByTestId("c").innerHTML).not.toContain("grow");
  });

  test("dataAttributes forwards data-* attributes to the root node", () => {
    render(
      <Card testId="c" dataAttributes={{ "data-path": "widgets/entity-card.tsx" }}>
        body
      </Card>,
    );
    expect(screen.getByTestId("c").getAttribute("data-path")).toBe("widgets/entity-card.tsx");
  });
});

describe("Section", () => {
  test("declared icon renders left of the title", () => {
    render(
      <Section title="Text" icon="tag" testId="s">
        <span>body</span>
      </Section>,
    );
    const titleEl = screen.getByTestId("s-title");
    expect(titleEl.querySelector("svg")).not.toBeNull();
    expect(titleEl.className).toContain("items-center");
  });

  test("no icon → header renders exactly as before (no svg, no layout change)", () => {
    render(
      <Section title="Text" testId="s">
        <span>body</span>
      </Section>,
    );
    const titleEl = screen.getByTestId("s-title");
    expect(titleEl.querySelector("svg")).toBeNull();
    expect(titleEl.textContent).toBe("Text");
  });
});

describe("Stack", () => {
  test("gap-Variante bildet auf die Tailwind-gap-Klasse ab", () => {
    render(
      <Stack testId="s" gap="lg">
        <span>a</span>
      </Stack>,
    );
    const el = screen.getByTestId("s");
    expect(el.className).toContain("flex flex-col");
    expect(el.className).toContain("gap-6");
  });

  test("default gap = md", () => {
    render(<Stack testId="s">x</Stack>);
    expect(screen.getByTestId("s").className).toContain("gap-4");
  });
});

describe("PageSection", () => {
  test("wrappt children mit einheitlichem Padding", () => {
    render(
      <PageSection testId="p">
        <span data-testid="child">x</span>
      </PageSection>,
    );
    expect(screen.getByTestId("p").className).toContain("px-4");
    expect(screen.getByTestId("child")).toBeDefined();
  });

  test("renders the same padding classes as FormScreenShell (fw#2640)", () => {
    render(
      <>
        <PageSection testId="page-pad">x</PageSection>
        <FormScreenShell testId="shell-pad">x</FormScreenShell>
      </>,
    );
    expect(paddingOf("page-pad")).toEqual(["pb-6", "pt-5", "px-4"]);
    expect(paddingOf("page-pad")).toEqual(paddingOf("shell-pad"));
    expect(screen.getByTestId("page-pad").className).toContain("md:px-10");
  });

  test("the pinned-footer screen form scrolls on the same inset as PageSection", () => {
    render(
      <>
        <PageSection testId="page-pad">x</PageSection>
        <defaultPrimitives.Form onSubmit={() => {}} screenForm fillHeight testId="sf">
          <div>body</div>
        </defaultPrimitives.Form>
      </>,
    );
    expect(paddingOf("sf-scroll")).toEqual(paddingOf("page-pad"));
    expect(screen.getByTestId("sf-scroll").className).toContain("md:px-10");
  });

  test("maxWidth=4xl sets the same width class as FormScreenShell maxWidth=4xl (fw#2640)", () => {
    render(
      <>
        <PageSection testId="page-4xl" maxWidth="4xl">
          x
        </PageSection>
        <FormScreenShell testId="shell-4xl" maxWidth="4xl">
          x
        </FormScreenShell>
      </>,
    );
    expect(screen.getByTestId("page-4xl").className).toContain("max-w-4xl");
    expect(screen.getByTestId("shell-4xl").className).toContain("max-w-4xl");
  });

  test("FormScreenShell erbt die Breite aus ScreenWidthProvider, explizites maxWidth gewinnt", () => {
    render(
      <ScreenWidthProvider width="full">
        <FormScreenShell testId="shell-ctx">x</FormScreenShell>
        <FormScreenShell testId="shell-explicit" maxWidth="3xl">
          x
        </FormScreenShell>
      </ScreenWidthProvider>,
    );
    expect(screen.getByTestId("shell-ctx").className).toContain("max-w-full");
    expect(screen.getByTestId("shell-explicit").className).toContain("max-w-3xl");
    expect(screen.getByTestId("shell-explicit").className).not.toContain("max-w-full");
  });

  test("FormScreenShell ohne Provider fällt auf 4xl zurück", () => {
    render(<FormScreenShell testId="shell-default">x</FormScreenShell>);
    expect(screen.getByTestId("shell-default").className).toContain("max-w-4xl");
  });

  test("default maxWidth stays full-width (existing behavior)", () => {
    render(<PageSection testId="p-default">x</PageSection>);
    expect(screen.getByTestId("p-default").className).toContain("max-w-full");
  });
});

describe("JsonView", () => {
  test("tokenisiert statt einen flachen String zu rendern — Keys/Strings/Zahlen/Booleans/null bekommen je eigene Klasse", () => {
    render(
      <DefaultJsonView testId="jv" value={{ name: "job-1", attempts: 3, ok: true, error: null }} />,
    );
    const spans = Array.from(screen.getByTestId("jv").querySelectorAll("span"));
    // 1 Key-Token pro Feld + 1 Value-Token (string/number/boolean/null) = 8.
    expect(spans.length).toBe(8);
    const classNames = new Set(spans.map((s) => s.className));
    expect(classNames.size).toBe(5);
  });

  test("Whitespace bleibt erhalten (pre-wrap) — mehrzeiliger, eingerückter Output statt einer kollabierten Zeile", () => {
    const value = { a: { b: 1 } };
    render(<DefaultJsonView testId="jv" value={value} />);
    const el = screen.getByTestId("jv");
    expect(el.className).toContain("whitespace-pre-wrap");
    expect(el.className).toContain("break-words");
    expect(el.textContent).toBe(JSON.stringify(value, null, 2));
    expect(el.textContent).toContain("\n");
  });

  test("indent-Prop steuert die Einrückung wie bei JSON.stringify", () => {
    const value = { a: 1 };
    render(<DefaultJsonView testId="jv" value={value} indent={4} />);
    expect(screen.getByTestId("jv").textContent).toBe(JSON.stringify(value, null, 4));
  });

  test("zirkulärer Wert wirft nicht — rendert einen [Circular]-Marker statt die Seite zu killen", () => {
    const circular: Record<string, unknown> = { name: "job-1" };
    circular["self"] = circular;
    expect(() => render(<DefaultJsonView testId="jv" value={circular} />)).not.toThrow();
    expect(screen.getByTestId("jv").textContent).toContain("[Circular]");
  });

  test("BigInt wirft nicht — wird als String serialisiert", () => {
    expect(() =>
      render(<DefaultJsonView testId="jv" value={{ amount: 9007199254740993n }} />),
    ).not.toThrow();
    expect(screen.getByTestId("jv").textContent).toContain("9007199254740993n");
  });

  test("undefined wirft nicht", () => {
    expect(() => render(<DefaultJsonView testId="jv" value={undefined} />)).not.toThrow();
  });
});
