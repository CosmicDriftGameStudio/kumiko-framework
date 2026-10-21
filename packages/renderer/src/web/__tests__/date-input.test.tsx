// DateInput: the text input displays and accepts locale-formatted dates; the icon button opens the DayPicker, and selection returns ISO-yyyy-mm-dd.
// The ISO → Date → ISO roundtrip must preserve the calendar day; otherwise the calendar can show the previous day in some timezones.

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateInput } from "../primitives/date-input.tsx";
import { render } from "./test-utils.tsx";

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

  test("Kalender-Button sitzt im Feld (rechts, absolut) statt als eigener Button daneben", () => {
    render(
      <DateInput id="d" name="d" value="2026-04-23" onChange={() => undefined} locale="de-DE" />,
    );
    const input = screen.getByRole("textbox");
    const trigger = screen.getByRole("button");
    expect(trigger.parentElement).toBe(input.parentElement);
    expect(input.parentElement?.className).toContain("relative");
    expect(trigger.className).toContain("absolute");
    expect(trigger.className).not.toContain("border");
    expect(input.className).toContain("pr-9");
    expect(trigger.getAttribute("aria-label")).not.toBeNull();
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
    // DayPicker exposes the calendar with a grid role; checking its existence is sufficient without pinning brittle DOM details.
    expect(await screen.findByRole("grid")).toBeTruthy();
  });

  test("Tag-Auswahl im Calendar: onChange feuert ISO yyyy-mm-dd", async () => {
    const user = userEvent.setup();
    const onChange = mock();
    render(<DateInput id="d" name="d" value="2026-04-23" onChange={onChange} locale="en-US" />);
    await user.click(screen.getByRole("button"));
    // react-day-picker renders each day as a gridcell. April 25, 2026 is a Saturday and is selectable in the visible month.
    const day25 = await screen.findByRole("gridcell", { name: /25/ });
    fireEvent.click(day25.querySelector("button") as HTMLButtonElement);
    expect(onChange).toHaveBeenCalledWith("2026-04-25");
  });

  // captionLayout="dropdown" renders month and year selects instead of only previous/next month controls.
  // min/max constrain the year selector through startMonth/endMonth.
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
    // rdp v9 renders the dropdowns as <select> elements (role=combobox). At least the year selector must be present for captionLayout to take effect.
    const combos = await screen.findAllByRole("combobox");
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
    // The range ends on April 10, 2026, so the 25th is outside it.
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
    const day25Button = (await screen.findByRole("gridcell", { name: /^25$/ })).querySelector(
      "button",
    ) as HTMLButtonElement;
    expect(day25Button.disabled).toBe(true);
  });
});
