//
// DateInput pinnt (seit #369): tippbares Text-Input zeigt das Datum
// locale-numerisch und akzeptiert Eingabe, ein Icon-Button öffnet das
// DayPicker, Auswahl gibt ISO-yyyy-mm-dd zurück. Wert-Roundtrip
// (ISO → Date → ISO) muss tag-stable sein, sonst zeigt der Calendar je
// nach Timezone den Vortag.

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateInput } from "../primitives/date-input";
import { render } from "./test-utils";

describe("DateInput", () => {
  test("Eingabefeld zeigt locale-numerisches Datum (de-DE)", () => {
    render(
      <DateInput id="d" name="d" value="2026-04-23" onChange={() => undefined} locale="de-DE" />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("23.04.2026");
  });

  test("Eingabefeld zeigt locale-numerisches Datum (en-US)", () => {
    render(
      <DateInput id="d" name="d" value="2026-04-23" onChange={() => undefined} locale="en-US" />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("04/23/2026");
  });

  test("Eingabefeld ist leer bei leerem Wert", () => {
    render(<DateInput id="d" name="d" value="" onChange={() => undefined} locale="de-DE" />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  test("Datum tippen → onChange feuert ISO yyyy-mm-dd", () => {
    const onChange = mock();
    render(<DateInput id="d" name="d" value="" onChange={onChange} locale="de-DE" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "23.04.2026" } });
    expect(onChange).toHaveBeenCalledWith("2026-04-23");
  });

  test("kein nativer date-input im DOM (Radix-Popover-Pattern, nicht type=date)", () => {
    render(
      <DateInput id="d" name="d" value="2026-04-23" onChange={() => undefined} locale="de-DE" />,
    );
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  test("hasError setzt aria-invalid auf dem Trigger", () => {
    render(
      <DateInput
        id="d"
        name="d"
        value="2026-04-23"
        onChange={() => undefined}
        locale="de-DE"
        hasError
      />,
    );
    expect(screen.getByRole("button").getAttribute("aria-invalid")).toBe("true");
  });

  test("disabled blockt Trigger-Click", () => {
    render(
      <DateInput
        id="d"
        name="d"
        value="2026-04-23"
        onChange={() => undefined}
        locale="de-DE"
        disabled
      />,
    );
    const trigger = screen.getByRole("button") as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });

  test("Popover öffnet auf Click und zeigt das DayPicker", async () => {
    const user = userEvent.setup();
    render(
      <DateInput id="d" name="d" value="2026-04-23" onChange={() => undefined} locale="de-DE" />,
    );
    await user.click(screen.getByRole("button"));
    // DayPicker rendert eine grid-Role für den Calendar; Existenz
    // reicht als Smoke-Test, ohne brittle DOM-Schnipsel zu pinnen.
    expect(screen.getByRole("grid")).toBeTruthy();
  });

  test("Tag-Auswahl im Calendar: onChange feuert ISO yyyy-mm-dd", async () => {
    const user = userEvent.setup();
    const onChange = mock();
    render(<DateInput id="d" name="d" value="2026-04-23" onChange={onChange} locale="en-US" />);
    await user.click(screen.getByRole("button"));
    // react-day-picker rendert jeden Tag als gridcell. Der 25. April
    // 2026 ist ein Samstag — pickbar im sichtbaren Monat.
    const day25 = screen.getByRole("gridcell", { name: /25/ });
    fireEvent.click(day25.querySelector("button") as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith("2026-04-25");
  });

  // Headline-Feature #369: captionLayout="dropdown" rendert Monats-/Jahres-
  // Selects statt nur Monats-Vor/Zurück. min/max begrenzen über
  // startMonth/endMonth den Jahres-Selector.
  test("Kalender zeigt Jahres-Dropdown, begrenzt durch min/max", async () => {
    const user = userEvent.setup();
    render(
      <DateInput
        id="d"
        name="d"
        value="2023-06-15"
        onChange={() => undefined}
        locale="de-DE"
        min="2020-01-01"
        max="2026-12-31"
      />,
    );
    await user.click(screen.getByRole("button"));
    // rdp v9 rendert die Dropdowns als <select> (role=combobox). Mind. der
    // Jahres-Selector muss da sein — sonst greift captionLayout nicht.
    const combos = screen.getAllByRole("combobox");
    expect(combos.length).toBeGreaterThanOrEqual(1);
    const yearSelect = combos.find((c) =>
      Array.from(c.querySelectorAll("option")).some((o) => o.textContent === "2023"),
    ) as HTMLSelectElement | undefined;
    if (!yearSelect) throw new Error("expected a year dropdown");
    const years = Array.from(yearSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(years).toContain("2020");
    expect(years).toContain("2026");
    expect(years).not.toContain("2019");
    expect(years).not.toContain("2027");
  });

  test("min/max grauen Out-of-Range-Tage aus", async () => {
    const user = userEvent.setup();
    const onChange = mock();
    // Range endet am 10. April 2026 — der 25. liegt außerhalb.
    render(
      <DateInput
        id="d"
        name="d"
        value="2026-04-05"
        onChange={onChange}
        locale="en-US"
        max="2026-04-10"
      />,
    );
    await user.click(screen.getByRole("button"));
    const day25Button = screen
      .getByRole("gridcell", { name: /^25$/ })
      .querySelector("button") as HTMLButtonElement;
    expect(day25Button.disabled).toBe(true);
  });
});
