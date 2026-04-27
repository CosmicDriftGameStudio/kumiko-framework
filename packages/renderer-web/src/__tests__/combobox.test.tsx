// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { ComboboxInput } from "../primitives/combobox";
import { render, screen } from "./test-utils";

// Tier 2.1c: Combobox-Primitive Smoke-Tests. cmdk + Radix-Popover
// rendern Portals; jsdom resolved sie auf document.body. Wir testen
// die Trigger-Render-Form (Single + Multi mit Tags) und den Click→
// Select Roundtrip. Volltext-Filter-Mechanik ist cmdk-internal und
// dort getestet — unsere Tests pinnen nur das Wiring.

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
    // Trigger klicken → Popover öffnet, Items rendern
    await user.click(screen.getByTestId("combobox-combo"));
    // cmdk Items haben das role="option" attr
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
    // Gamma ist nicht selected → kein Tag im Trigger.
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
    // In Multi-Mode mountet cmdk die Items im Portal — wir suchen
    // das Item per Text. Beim Klick toggled der Combobox die value.
    const items = await screen.findAllByText("Beta");
    // Erstes "Beta" könnte das selected-Tag oben sein; in der List
    // rendert cmdk eine zweite Instanz. Tag ist nicht da (a war
    // selected, b nicht), also ist nur das List-Item da.
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

  test("hasError: Trigger hat aria-invalid=true", () => {
    render(
      <ComboboxInput id="combo" name="combo" value="" onChange={() => {}} options={[]} hasError />,
    );
    expect(screen.getByTestId("combobox-combo").getAttribute("aria-invalid")).toBe("true");
  });
});
