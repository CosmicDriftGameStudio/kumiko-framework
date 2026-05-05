import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

// Combobox-Demo-Daten: 3 Items mit unterschiedlichen Anfangsbuchstaben.
// Tippt der User "A", muss "API" als einzige übrig bleiben — Regression-
// Surface für den Bug "Suche filtert alles weg".
const COMBOBOX_OPTIONS = [
  { value: "api", label: "API" },
  { value: "backend", label: "Backend" },
  { value: "cache", label: "Cache" },
] as const;

export function InputsDemo(): ReactNode {
  const { Input, Field } = usePrimitives();
  const [text, setText] = useState("Hello");
  const [num, setNum] = useState<number | "">(42);
  const [bool, setBool] = useState(true);
  const [date, setDate] = useState("2026-04-25");
  const [select, setSelect] = useState("draft");
  const [textarea, setTextarea] = useState("Zeile 1\nZeile 2\nZeile 3");
  const [moneyEur, setMoneyEur] = useState<number | "">(123456);
  const [moneyUsd, setMoneyUsd] = useState<number | "">(2599);
  const [moneyJpy, setMoneyJpy] = useState<number | "">(150000);
  const [timestamp, setTimestamp] = useState("2026-04-25T13:45");
  const [comboSingleLocal, setComboSingleLocal] = useState("");
  const [comboMultiLocal, setComboMultiLocal] = useState<readonly string[]>([]);
  const [comboSingleRemote, setComboSingleRemote] = useState("");
  const [comboMultiRemote, setComboMultiRemote] = useState<readonly string[]>([]);
  // Remote-Mode-Simulation: Caller erhält den Suchbegriff via
  // onSearchChange und filtert die options selbst — Combobox bekommt
  // "shouldFilter=false"-Mode (cmdk filtert nicht client-side, Caller
  // ist authoritative für Sichtbarkeit). Production-Setup würde den
  // Suchbegriff an den Server schicken, hier filtern wir im Memory.
  const [remoteQ, setRemoteQ] = useState("");
  const remoteOptions = useMemo(() => {
    if (remoteQ === "") return COMBOBOX_OPTIONS;
    const needle = remoteQ.toLowerCase();
    return COMBOBOX_OPTIONS.filter((o) => o.label.toLowerCase().includes(needle));
  }, [remoteQ]);

  return (
    <DemoPage
      title="Inputs"
      description="Alle Input-Kinds aus dem Primitives-Contract — text, number, money, boolean, date, timestamp, select, textarea, combobox."
    >
      <DemoSection title="Text">
        <Field id="demo-text" label="Title">
          <Input kind="text" id="demo-text" name="text" value={text} onChange={setText} />
        </Field>
      </DemoSection>
      <DemoSection title="Text mit Placeholder">
        <Field id="demo-text-ph" label="Search">
          <Input
            kind="text"
            id="demo-text-ph"
            name="search"
            value=""
            onChange={() => undefined}
            placeholder="Suchen…"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Number">
        <Field id="demo-num" label="Priority">
          <Input
            kind="number"
            id="demo-num"
            name="priority"
            value={num}
            onChange={(v) => setNum(v ?? "")}
          />
        </Field>
      </DemoSection>
      <DemoSection title="Boolean (Checkbox)">
        <Field id="demo-bool" label="Done?">
          <Input kind="boolean" id="demo-bool" name="done" value={bool} onChange={setBool} />
        </Field>
      </DemoSection>
      <DemoSection title="Money (EUR — de-DE — Tausender-Trenner + €)">
        <Field id="demo-money-eur" label="Preis">
          <Input
            kind="money"
            id="demo-money-eur"
            name="priceEur"
            value={moneyEur}
            onChange={(v) => setMoneyEur(v ?? "")}
            currency="EUR"
            locale="de-DE"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Money (USD — en-US — $ + comma-separator)">
        <Field id="demo-money-usd" label="Preis">
          <Input
            kind="money"
            id="demo-money-usd"
            name="priceUsd"
            value={moneyUsd}
            onChange={(v) => setMoneyUsd(v ?? "")}
            currency="USD"
            locale="en-US"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Money (JPY — ja-JP — ¥ ohne Dezimalen)">
        <Field id="demo-money-jpy" label="Preis">
          <Input
            kind="money"
            id="demo-money-jpy"
            name="priceJpy"
            value={moneyJpy}
            onChange={(v) => setMoneyJpy(v ?? "")}
            currency="JPY"
            locale="ja-JP"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Date (Radix-Popover + Calendar)">
        <Field id="demo-date" label="Due date">
          <Input
            kind="date"
            id="demo-date"
            name="dueDate"
            value={date}
            onChange={(v) => setDate(v ?? "")}
            locale="de-DE"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Timestamp (Datum + Uhrzeit)">
        <Field id="demo-timestamp" label="Termin">
          <Input
            kind="timestamp"
            id="demo-timestamp"
            name="appointment"
            value={timestamp}
            onChange={(v) => setTimestamp(v ?? "")}
          />
        </Field>
      </DemoSection>
      <DemoSection title="Select">
        <Field id="demo-select" label="Status">
          <Input
            kind="select"
            id="demo-select"
            name="status"
            value={select}
            onChange={setSelect}
            options={["draft", "active", "blocked", "done"]}
          />
        </Field>
      </DemoSection>
      <DemoSection title="Textarea (multiline)">
        <Field id="demo-textarea" label="Notes">
          <Input
            kind="textarea"
            id="demo-textarea"
            name="notes"
            value={textarea}
            onChange={setTextarea}
            rows={4}
          />
        </Field>
      </DemoSection>
      <DemoSection title="Combobox Single (Local-Filter — cmdk filtert client-side)">
        <Field id="demo-combo-single-local" label="Service">
          <Input
            kind="combobox"
            id="demo-combo-single-local"
            name="comboSingleLocal"
            value={comboSingleLocal}
            onChange={setComboSingleLocal}
            options={[...COMBOBOX_OPTIONS]}
            placeholder="Service wählen…"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Combobox Multi (Local-Filter)">
        <Field id="demo-combo-multi-local" label="Services">
          <Input
            kind="combobox"
            id="demo-combo-multi-local"
            name="comboMultiLocal"
            multiple
            value={comboMultiLocal}
            onChange={setComboMultiLocal}
            options={[...COMBOBOX_OPTIONS]}
            placeholder="Services wählen…"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Combobox Single (Remote-Filter — Caller filtert via onSearchChange)">
        <Field id="demo-combo-single-remote" label="Service">
          <Input
            kind="combobox"
            id="demo-combo-single-remote"
            name="comboSingleRemote"
            value={comboSingleRemote}
            onChange={setComboSingleRemote}
            options={[...remoteOptions]}
            onSearchChange={setRemoteQ}
            placeholder="Service wählen…"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Combobox Multi (Remote-Filter)">
        <Field id="demo-combo-multi-remote" label="Services">
          <Input
            kind="combobox"
            id="demo-combo-multi-remote"
            name="comboMultiRemote"
            multiple
            value={comboMultiRemote}
            onChange={setComboMultiRemote}
            options={[...remoteOptions]}
            onSearchChange={setRemoteQ}
            placeholder="Services wählen…"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Field mit Error">
        <Field
          id="demo-error"
          label="Title"
          required
          issues={[{ path: "title", code: "required", i18nKey: "Bitte Titel angeben" }]}
        >
          <Input
            kind="text"
            id="demo-error"
            name="title"
            value=""
            onChange={() => undefined}
            hasError
            required
          />
        </Field>
      </DemoSection>
    </DemoPage>
  );
}
