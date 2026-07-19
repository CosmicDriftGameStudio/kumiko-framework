// Standalone-Mount-Page für DateInput (kind:"date") ohne createKumikoApp.
// Reproduziert den #369-Folgebug (doppelter Kalender-Header) im echten
// Browser: jsdom rendert kein CSS und das Duplikat-Label ist ein
// aria-hidden <span> — erst Chromium zeigt das sichtbare Doppel. onChange
// schreibt den ISO-Wert auf body[data-date], damit der Spec ohne
// page.evaluate auslesen kann.

import { createStaticLocaleResolver, LocaleProvider } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useState } from "react";
import { DateInput } from "../../src/primitives/date-input";

// "de" — DateInput below is mounted with locale="de-DE" (German calendar
// labels are what the specs assert against).
const localeResolver = createStaticLocaleResolver({ locale: "de" });

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
    <LocaleProvider resolver={localeResolver}>
      <DateTestPageInner />
    </LocaleProvider>
  );
}
