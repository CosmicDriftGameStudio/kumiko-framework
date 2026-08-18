// DateField rendering tests — happy-dom + @testing-library/react. Pins
// that the input's `placeholder` actually comes from `t()` + resolvedLocale
// (date-parse.test.ts only covers the pure formatDatePlaceholder logic; a
// wrong/renamed i18n key or a missing LocaleProvider fallback would stay
// green there).

import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import {
  createStaticLocaleResolver,
  kumikoDefaultTranslations,
  LocaleProvider,
} from "@cosmicdrift/kumiko-renderer";
import { render, screen } from "@testing-library/react";
import { DateField } from "../date-field";

function renderWithLocale(locale: string) {
  return render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale })}
      fallbackBundles={[{ de: localeDeBundle }, kumikoDefaultTranslations]}
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
