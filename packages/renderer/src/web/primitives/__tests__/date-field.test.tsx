// DateField rendering tests — happy-dom + @testing-library/react. Pins
// that the input's `placeholder` actually comes from `t()` + resolvedLocale
// (date-parse.test.ts only covers the pure formatDatePlaceholder logic; a
// wrong/renamed i18n key or a missing LocaleProvider fallback would stay
// green there).

import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "../../../index.ts";
import { DateField } from "../date-field.tsx";

function renderWithLocale(locale: string) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale })}
      fallbackBundles={
        locale.split("-")[0] === "de"
          ? [{ de: localeDeBundle }, kumikoDefaultTranslations]
          : [kumikoDefaultTranslations]
      }
    >
      <DateField id="date" name="date" value="" onChange={() => {}} locale={locale} />
    </LocaleProvider>,
  );
}

describe("DateField placeholder", () => {
  test("de-DE → placeholder built from t() keys, not a hardcoded pattern", () => {
    renderWithLocale("de-DE");
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("TT.MM.JJJJ");
  });

  test("en-US → placeholder built from t() keys, not a hardcoded pattern", () => {
    renderWithLocale("en-US");
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toBe("MM/DD/YYYY");
  });
});

// rdp marks the weekday <thead> aria-hidden, so role queries cannot see it.
function weekdayHeaders(): (string | null)[] {
  return Array.from(document.querySelectorAll("th[scope='col']"), (th) => th.textContent);
}

describe("DateField calendar popover", () => {
  async function openCalendar(locale: string, value: string) {
    const view = render(
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale })}
        fallbackBundles={[kumikoDefaultTranslations]}
      >
        <DateField id="date" name="date" value={value} onChange={() => {}} locale={locale} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    await screen.findByRole("grid");
    return view;
  }

  test("de → Monday-first German weekday header and German month names", async () => {
    await openCalendar("de", "2026-03-15");
    const headers = weekdayHeaders();
    expect(headers[0]).toBe("Mo");
    expect(headers[6]).toBe("So");
    const monthSelect = screen.getByRole("combobox", { name: "Monat auswählen" });
    expect(Array.from(monthSelect.querySelectorAll("option"), (o) => o.textContent)).toContain(
      "März",
    );
  });

  test("en → Sunday-first weekday header", async () => {
    await openCalendar("en", "2026-03-15");
    expect(weekdayHeaders()[0]).toBe("Su");
  });

  test("prev/next buttons flank the caption, outside the dropdown container", async () => {
    await openCalendar("de", "2026-03-15");
    const prev = screen.getByRole("button", { name: "Zum vorherigen Monat" });
    const next = screen.getByRole("button", { name: "Zum nächsten Monat" });
    const monthSelect = screen.getByRole("combobox", { name: "Monat auswählen" });
    expect(prev.parentElement).toBe(next.parentElement);
    expect(prev.parentElement?.contains(monthSelect)).toBe(true);
    expect(prev.contains(monthSelect)).toBe(false);
    expect(prev.nextElementSibling?.contains(monthSelect)).toBe(true);
    expect(monthSelect.closest("[class*='absolute']")).toBeNull();
    expect(prev.querySelector("svg")?.getAttribute("class")).toContain("fill-current");
  });
});
