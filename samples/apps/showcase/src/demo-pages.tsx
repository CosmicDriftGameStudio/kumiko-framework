// Demo-Pages für den Showcase. Rendert pro Primitive eine eigene
// Page mit allen Varianten — der schnellste Weg zu sehen wie Button,
// Input, Banner, Text aussehen ohne die Form-Pipeline zu durchlaufen.
//
// Konsumiert die Primitives über `usePrimitives()` — so sieht man
// ECHT was der DefaultPrimitives-Renderer macht (kein hand-gerolltes
// Tailwind drüber).

import { usePrimitives } from "@kumiko/renderer";
import { type ReactNode, useState } from "react";

// Gemeinsamer Page-Wrapper: Title + Description + Content-Spalte mit
// max-w. Lebt nur hier im Sample, ist kein Framework-Konzept.
function DemoPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactNode {
  // Konsistent zum Form/Liste-Pattern: Top-Action-Bar mit Title (h-12,
  // bg-muted/30, border-b), Content darunter mit eigenem p-6. Main
  // selber hat kein Padding mehr — Pages liefern ihres.
  return (
    <div className="flex flex-col w-full">
      <div className="h-12 px-6 bg-muted/30 border-b flex items-center gap-3">
        <div className="text-base font-semibold tracking-tight truncate">{title}</div>
      </div>
      <div className="px-6 pt-6 pb-12 max-w-4xl flex flex-col gap-6">
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {children}
      </div>
    </div>
  );
}

// Section innerhalb einer Demo-Page: kleinerer Header + Inhalt-Box.
// Header rendert über die Heading-Primitive (variant="section"), Inhalt
// bleibt als rounded-Border-Box damit man pro Variant den abgegrenzten
// Bereich sieht.
function DemoSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  const { Heading } = usePrimitives();
  return (
    <section className="flex flex-col gap-3">
      <Heading variant="section">{title}</Heading>
      <div className="flex flex-col gap-3 rounded-md border p-4">{children}</div>
    </section>
  );
}

// ---- Button-Demo: alle Variants + disabled-State ----

export function ButtonsDemo(): ReactNode {
  const { Button } = usePrimitives();
  return (
    <DemoPage
      title="Buttons"
      description="Drei Variants — primary, secondary, danger — plus disabled-State."
    >
      <DemoSection title="Variants">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
        </div>
      </DemoSection>
      <DemoSection title="Disabled">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled>
            Primary
          </Button>
          <Button variant="secondary" disabled>
            Secondary
          </Button>
          <Button variant="danger" disabled>
            Danger
          </Button>
        </div>
      </DemoSection>
    </DemoPage>
  );
}

// ---- Input-Demo: alle Kinds ----

export function InputsDemo(): ReactNode {
  const { Input, Field } = usePrimitives();
  const [text, setText] = useState("Hello");
  const [num, setNum] = useState<number | "">(42);
  const [bool, setBool] = useState(true);
  const [date, setDate] = useState("2026-04-25");
  const [select, setSelect] = useState("draft");
  const [textarea, setTextarea] = useState("Zeile 1\nZeile 2\nZeile 3");

  return (
    <DemoPage
      title="Inputs"
      description="Alle Input-Kinds aus dem Primitives-Contract — text, number, boolean, date, select, textarea."
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

// ---- Banner-Demo ----

export function BannerDemo(): ReactNode {
  const { Banner, Button, Text } = usePrimitives();
  return (
    <DemoPage
      title="Banner"
      description="Variants info / error, mit optionalem Action-Slot rechts."
    >
      <DemoSection title="Info">
        <Banner variant="info">
          <Text>Das ist eine Info-Nachricht.</Text>
        </Banner>
      </DemoSection>
      <DemoSection title="Error">
        <Banner variant="error">
          <Text>Etwas ist schiefgegangen.</Text>
        </Banner>
      </DemoSection>
      <DemoSection title="Error mit Action">
        <Banner
          variant="error"
          actions={
            <Button variant="secondary" onClick={() => undefined}>
              Neu laden
            </Button>
          }
        >
          <Text>Optimistic Lock — Datensatz wurde geändert.</Text>
        </Banner>
      </DemoSection>
    </DemoPage>
  );
}

// ---- Text-Demo ----

export function TextDemo(): ReactNode {
  const { Text } = usePrimitives();
  return (
    <DemoPage title="Text" description="Variants body / small / code / required-mark.">
      <DemoSection title="Body (default)">
        <Text>Standard Body-Text in der App-Schrift.</Text>
      </DemoSection>
      <DemoSection title="Small">
        <Text variant="small">Kleinerer, gedämpfter Text — Hint, Helper, Caption.</Text>
      </DemoSection>
      <DemoSection title="Code">
        <Text>
          Wert kommt aus <Text variant="code">field.values.title</Text>.
        </Text>
      </DemoSection>
      <DemoSection title="Required-Mark">
        <Text>
          Title <Text variant="required-mark">*</Text>
        </Text>
      </DemoSection>
    </DemoPage>
  );
}
