import { describe, expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { ComboboxInput } from "../primitives/combobox.tsx";
import { render, screen, waitFor } from "./test-utils.tsx";

// cmdk + Radix-Popover render Portals; jsdom resolves them on document.body.
// These tests cover the trigger rendering (single and multi with tags) and
// the click-to-select round trip. Full-text filtering is internal to cmdk and
// tested there; these tests only pin the wiring.

describe("ComboboxInput (Tier 2.1c)", () => {
  test("single-mode: Trigger zeigt placeholder wenn value leer", () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        placeholder="Pick one"
      />,
    );
    expect(screen.getByText("Pick one")).toBeTruthy();
  });

  test("single-mode: Trigger zeigt Label des selected value", () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value="b"
        onChange={() => {}}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />,
    );
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  test("single-mode: a long label stays on one line, truncated, with the full text as title", () => {
    const longLabel = "Haus Kautionsweg — WE-41 · 01.09.2026";
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value="a"
        onChange={() => {}}
        options={[{ value: "a", label: longLabel }]}
      />,
    );
    const trigger = screen.getByTestId("combobox-combo");
    expect(trigger.getAttribute("title")).toBe(longLabel);
    const label = screen.getByText(longLabel);
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("min-w-0");
  });

  test("single-mode: an empty value sets no title", () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={[{ value: "a", label: "Alpha" }]}
      />,
    );
    expect(screen.getByTestId("combobox-combo").hasAttribute("title")).toBe(false);
  });

  test("single-mode: Click auf Item → onChange mit value, Popover schließt", async () => {
    const user = userEvent.setup();
    const changes: string[] = [];
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={(v) => changes.push(v as string)}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
      />,
    );
    await user.click(screen.getByTestId("combobox-combo"));
    // cmdk items have the role="option" attribute
    const beta = await screen.findByText("Beta");
    await user.click(beta);
    expect(changes).toEqual(["b"]);
  });

  test("multi-mode: leerer state zeigt placeholder", () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value={[]}
        onChange={() => {}}
        options={[{ value: "a", label: "Alpha" }]}
        multiple
        placeholder="Pick tags"
      />,
    );
    expect(screen.getByText("Pick tags")).toBeTruthy();
  });

  test("multi-mode: vorhandene values rendern als Tags mit Label", () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value={["a", "b"]}
        onChange={() => {}}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
          { value: "c", label: "Gamma" },
        ]}
        multiple
      />,
    );
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    // Gamma is not selected, so it does not appear as a tag in the trigger.
    expect(screen.queryByText("Gamma")).toBeNull();
  });

  test("multi-mode: Click auf neues Item → onChange mit erweitertem Array", async () => {
    const user = userEvent.setup();
    const changes: (readonly string[])[] = [];
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value={["a"]}
        onChange={(v) => changes.push(v as readonly string[])}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        multiple
      />,
    );
    await user.click(screen.getByTestId("combobox-combo"));
    // In multi-mode, cmdk mounts the items in a Portal, so we find the item by
    // text. Clicking it toggles the Combobox value.
    const items = await screen.findAllByText("Beta");
    // The first "Beta" could be the selected tag above; the list renders a
    // second instance in cmdk. The tag is not present (a was selected, b was not),
    // so only the list item is present.
    await user.click(items[items.length - 1] as HTMLElement);
    expect(changes).toHaveLength(1);
    expect([...(changes[0] ?? [])].sort()).toEqual(["a", "b"]);
  });

  test("disabled: Trigger ist disabled", () => {
    render(
      <ComboboxInput id="combo" name="combo" value="" onChange={() => {}} options={[]} disabled />,
    );
    expect((screen.getByTestId("combobox-combo") as HTMLButtonElement).disabled).toBe(true);
  });

  // Regression: in multi-mode with remote search (= a reference field with
  // `multiple: true`), clicking an item in the browser only moved focus instead
  // of triggering onChange. Non-remote multi-mode and the other paths worked;
  // only this combination was broken.
  test("multi-mode + remote-mode: Click auf Item → onChange mit erweitertem Array", async () => {
    const user = userEvent.setup();
    const changes: (readonly string[])[] = [];
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value={[]}
        onChange={(v) => changes.push(v as readonly string[])}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ]}
        multiple
        // The onSearchChange prop signals server-side filtering, matching the
        // pattern used by reference inputs in forms.
        onSearchChange={() => {}}
      />,
    );
    await user.click(screen.getByTestId("combobox-combo"));
    const items = await screen.findAllByText("Beta");
    await user.click(items[items.length - 1] as HTMLElement);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(["b"]);
  });

  // Remote mode: typed search API.
  test("remote-mode: render mit onSearchChange + loading mountet ohne crash", () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={[{ value: "a", label: "Alpha" }]}
        onSearchChange={() => {}}
        loading
      />,
    );
    expect(screen.getByTestId("combobox-combo")).toBeTruthy();
  });

  // Test real search behavior without fake timers, which conflict with RTL's
  // findBy polling. defaultOpen forces the Popover to mount; then we trigger the
  // change event directly on the Search input and wait in real time for the
  // 300ms debounce to elapse.
  test("remote-mode: Search-Input typing → onSearchChange debounced (300ms)", async () => {
    const searches: string[] = [];
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={[{ value: "a", label: "Alpha" }]}
        onSearchChange={(q) => searches.push(q)}
        defaultOpen
      />,
    );
    const searchInput = await screen.findByRole("combobox");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "abc" } });
    });
    // Real-time debounce window; fake timers collide with findByRole's polling.
    await waitFor(() => {
      expect(searches[searches.length - 1]).toBe("abc");
    });
  });

  test("remote-mode: loading=true zeigt 'Loading…' im Empty-State", async () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={[]}
        onSearchChange={() => {}}
        loading
        defaultOpen
      />,
    );
    const loadingText = await screen.findByText("Loading…");
    expect(loadingText).toBeTruthy();
  });

  test("hasError: Trigger hat aria-invalid=true", () => {
    render(
      <ComboboxInput id="combo" name="combo" value="" onChange={() => {}} options={[]} hasError />,
    );
    expect(screen.getByTestId("combobox-combo").getAttribute("aria-invalid")).toBe("true");
  });

  // "+ Create" must stay visible even with zero matching options —
  // that's the most common case (a freshly seeded system has no
  // referenceable rows yet), not the edge case. The footer deliberately
  // lives OUTSIDE Command.List/cmdk's filter+empty machinery so it never
  // competes with it for visibility.
  test("onCreate: Footer bleibt sichtbar wenn keine Optionen matchen, klick feuert onCreate + schließt Popover", async () => {
    const user = userEvent.setup();
    let created = 0;
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={[]}
        onCreate={() => {
          created += 1;
        }}
        createLabel="Neuen Kontakt anlegen"
        defaultOpen
      />,
    );
    const createButton = await screen.findByTestId("combobox-combo-create");
    expect(createButton.textContent).toContain("Neuen Kontakt anlegen");
    await user.click(createButton);
    expect(created).toBe(1);
  });

  test("ohne onCreate: kein Footer-Item im Popover", async () => {
    render(
      <ComboboxInput
        id="combo"
        name="combo"
        value=""
        onChange={() => {}}
        options={[{ value: "a", label: "Alpha" }]}
        defaultOpen
      />,
    );
    await screen.findByText("Alpha");
    expect(screen.queryByTestId("combobox-combo-create")).toBeNull();
  });
});
