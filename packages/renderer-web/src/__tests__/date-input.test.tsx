//
// DateInput pinnt: Trigger zeigt formatiertes Datum (locale-aware),
// Popover öffnet das DayPicker, Auswahl gibt ISO-yyyy-mm-dd zurück.
// Wert-Roundtrip (ISO → Date → ISO) muss tag-stable sein, sonst
// zeigt der Calendar je nach Timezone den Vortag.

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateInput } from "../primitives/date-input";

describe("DateInput", () => {
  test("trigger zeigt formatiertes Datum (de-DE)", () => {
    render(
      <DateInput id="d" name="d" value="2026-04-23" onChange={() => undefined} locale="de-DE" />,
    );
    expect(screen.getByRole("button").textContent).toContain("23. April 2026");
  });

  test("trigger zeigt formatiertes Datum (en-US)", () => {
    render(
      <DateInput id="d" name="d" value="2026-04-23" onChange={() => undefined} locale="en-US" />,
    );
    expect(screen.getByRole("button").textContent).toContain("April 23, 2026");
  });

  test('trigger zeigt "—" Placeholder bei leerem Wert', () => {
    render(<DateInput id="d" name="d" value="" onChange={() => undefined} locale="de-DE" />);
    expect(screen.getByRole("button").textContent).toContain("—");
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
});
