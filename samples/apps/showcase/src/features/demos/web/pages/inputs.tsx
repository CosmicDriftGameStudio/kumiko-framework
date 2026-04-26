import { usePrimitives } from "@kumiko/renderer";
import { type ReactNode, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

export function InputsDemo(): ReactNode {
  const { Input, Field } = usePrimitives();
  const [text, setText] = useState("Hello");
  const [num, setNum] = useState<number | "">(42);
  const [bool, setBool] = useState(true);
  const [date, setDate] = useState("2026-04-25");
  const [select, setSelect] = useState("draft");
  const [textarea, setTextarea] = useState("Zeile 1\nZeile 2\nZeile 3");
  const [moneyEur, setMoneyEur] = useState<number | "">(1299);
  const [moneyUsd, setMoneyUsd] = useState<number | "">(2599);
  const [moneyJpy, setMoneyJpy] = useState<number | "">(1500);
  const [timestamp, setTimestamp] = useState("2026-04-25T13:45");

  return (
    <DemoPage
      title="Inputs"
      description="Alle Input-Kinds aus dem Primitives-Contract — text, number, money, boolean, date, timestamp, select, textarea."
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
      <DemoSection title="Money (EUR — Default)">
        <Field id="demo-money-eur" label="Preis">
          <Input
            kind="money"
            id="demo-money-eur"
            name="priceEur"
            value={moneyEur}
            onChange={(v) => setMoneyEur(v ?? "")}
          />
        </Field>
      </DemoSection>
      <DemoSection title="Money (USD — andere Currency)">
        <Field id="demo-money-usd" label="Preis">
          <Input
            kind="money"
            id="demo-money-usd"
            name="priceUsd"
            value={moneyUsd}
            onChange={(v) => setMoneyUsd(v ?? "")}
            currency="USD"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Money (JPY — 0 Dezimalen)">
        <Field id="demo-money-jpy" label="Preis">
          <Input
            kind="money"
            id="demo-money-jpy"
            name="priceJpy"
            value={moneyJpy}
            onChange={(v) => setMoneyJpy(v ?? "")}
            currency="JPY"
          />
        </Field>
      </DemoSection>
      <DemoSection title="Date">
        <Field id="demo-date" label="Due date">
          <Input
            kind="date"
            id="demo-date"
            name="dueDate"
            value={date}
            onChange={(v) => setDate(v ?? "")}
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
