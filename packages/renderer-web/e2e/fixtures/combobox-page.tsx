// Standalone-Mount-Page für ComboboxInput (ohne createKumikoApp /
// AppSchema-Drumherum). Ziel: Browser-Reality des Mouse-Click-Bugs
// reproduzieren, den jsdom-Tests verfehlen.
//
// Drei Test-Surfaces (data-testid):
//   - combo-single-local  — Single-Mode, kein onSearchChange (cmdk-Filter)
//   - combo-multi-local   — Multi-Mode, kein onSearchChange
//   - combo-single-remote — Single-Mode mit onSearchChange (Caller-Filter)
//
// Output-Tracking: jeder onChange schreibt den neuen Wert in eine
// data-* Property auf dem Body, damit der Spec ohne page.evaluate-Round
// auslesen kann (`getAttribute('data-combo-single-local')`).

import { createStaticLocaleResolver, LocaleProvider } from "@kumiko/renderer-web";
import { type ReactNode, useMemo, useState } from "react";
import { ComboboxInput } from "../../src/primitives/combobox";

const OPTIONS = [
  { value: "api", label: "API" },
  { value: "backend", label: "Backend" },
  { value: "cache", label: "Cache" },
] as const;

const localeResolver = createStaticLocaleResolver({ locale: "en" });

function ComboboxTestPageInner(): ReactNode {
  const [single, setSingle] = useState("");
  const [multi, setMulti] = useState<readonly string[]>([]);
  const [remoteSingle, setRemoteSingle] = useState("");
  const [remoteQ, setRemoteQ] = useState("");
  const remoteOptions = useMemo(
    () =>
      remoteQ === ""
        ? OPTIONS
        : OPTIONS.filter((o) => o.label.toLowerCase().includes(remoteQ.toLowerCase())),
    [remoteQ],
  );

  return (
    <div style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
      <h1>Combobox e2e</h1>
      <section data-testid="section-single-local">
        <h2>Single Local</h2>
        <ComboboxInput
          id="combo-single-local"
          name="single-local"
          value={single}
          onChange={(v) => {
            setSingle(v);
            document.body.setAttribute("data-combo-single-local", v);
          }}
          options={[...OPTIONS]}
        />
      </section>
      <section data-testid="section-multi-local">
        <h2>Multi Local</h2>
        <ComboboxInput
          id="combo-multi-local"
          name="multi-local"
          multiple
          value={multi}
          onChange={(v) => {
            setMulti(v);
            document.body.setAttribute("data-combo-multi-local", v.join(","));
          }}
          options={[...OPTIONS]}
        />
      </section>
      <section data-testid="section-single-remote">
        <h2>Single Remote</h2>
        <ComboboxInput
          id="combo-single-remote"
          name="single-remote"
          value={remoteSingle}
          onChange={(v) => {
            setRemoteSingle(v);
            document.body.setAttribute("data-combo-single-remote", v);
          }}
          options={[...remoteOptions]}
          onSearchChange={setRemoteQ}
        />
      </section>
    </div>
  );
}

function ComboboxTestPage(): ReactNode {
  return (
    <LocaleProvider resolver={localeResolver}>
      <ComboboxTestPageInner />
    </LocaleProvider>
  );
}

export { ComboboxTestPage };
