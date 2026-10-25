// Standalone mount page for DateInput (kind:"date") without createKumikoApp.
// Reproduces the #369 follow-up bug (doubled calendar header) in a real
// browser: jsdom renders no CSS and the duplicate label is an
// aria-hidden <span> — only Chromium shows the visible double. onChange
// writes the ISO value to body[data-date] so the spec can read it without
// page.evaluate.

import { kumikoDefaultTranslations } from "@cosmicdrift/kumiko-renderer";
import { createStaticLocaleResolver, LocaleProvider } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import { DateInput } from "../../src/web/primitives/date-input";

// "de" — DateInput below is mounted with locale="de-DE" (German calendar
// labels are what the specs assert against).
const localeResolver = createStaticLocaleResolver({ locale: "en" });

function DateTestPageInner(): ReactNode {
  const [value, setValue] = useState("2021-01-01");
  return (
    <div style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1>Date e2e</h1>
      <section data-testid="section-date">
        <DateInput
          id="date-field"
          name="date"
          value={value}
          locale="de-DE"
          onChange={(v) => {
            const next = v ?? "";
            setValue(next);
            document.body.setAttribute("data-date", next);
          }}
        />
      </section>
    </div>
  );
}

export function DateTestPage(): ReactNode {
  return (
    <LocaleProvider resolver={localeResolver} fallbackBundles={[kumikoDefaultTranslations]}>
      <DateTestPageInner />
    </LocaleProvider>
  );
}
