// Visueller Katalog des Widget-Kits — jede Sektion zeigt ein Widget mit
// statischen Daten. Dient zugleich als e2e-Renderfläche (content.spec).

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import {
  AiTextArea,
  AiTextField,
  BooleanField,
  CollapsibleSection,
  ComparisonTable,
  DateField,
  DetailList,
  Drawer,
  EmptyState,
  InfinityList,
  MiniStat,
  ModeSwitch,
  MoneyField,
  PercentField,
  ProgressBar,
  RangeField,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ResultPanel,
  ResultTable,
  SectionCard,
  SelectField,
  StatCard,
  StatusBadge,
  StatusBarChart,
  TextareaField,
  TextField,
  TimeseriesChart,
  useDraft,
} from "@cosmicdrift/kumiko-renderer-web";
import { Wallet } from "lucide-react";
import { type ReactNode, useState } from "react";

const UPTIME = Array.from({ length: 90 }, (_, i) => ({
  key: `day-${i}`,
  level: i === 30 ? 0.25 : i % 17 === 0 ? 0.75 : 1,
  tone: i === 30 ? ("critical" as const) : i % 17 === 0 ? ("warn" as const) : ("ok" as const),
  label: `Tag ${i + 1}`,
}));

const RESPONSE_TIMES = Array.from({ length: 48 }, (_, i) => ({
  atMs: i * 30 * 60 * 1000,
  value: i === 20 ? null : 120 + Math.round(80 * Math.abs(Math.sin(i / 5))),
}));

export function Widgets(): ReactNode {
  const [mode, setMode] = useState<"annuity" | "fixed">("annuity");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { Button } = usePrimitives();
  return (
    <div className="flex flex-col gap-6 p-6" data-testid="widgets-page">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Wallet className="size-4" aria-hidden="true" />}
          label="Portfolio"
          value="92.753 €"
          sub="über 4 Konten"
          delta={{ value: "2,1 %", direction: "up", tone: "positive" }}
          spark={[3, 5, 4, 7, 6, 9, 11, 10]}
        />
        <StatCard label="Restschuld" value="184.000 €" tone="warn" trend="−1.200 €/Monat" />
        <MiniStat label="Zins p.a." value="3,1 %" />
        <MiniStat label="Rate" value="890 €" tone="positive" emphasize />
      </div>

      <SectionCard
        title="Uptime"
        subtitle="Letzte 90 Tage"
        action={<StatusBadge tone="ok">Operational</StatusBadge>}
      >
        <StatusBarChart
          ariaLabel="Uptime der letzten 90 Tage"
          entries={UPTIME}
          startLabel="90 Tage"
          endLabel="heute"
        />
      </SectionCard>

      <SectionCard title="Antwortzeit" subtitle="Letzte 24 Stunden">
        <TimeseriesChart
          points={RESPONSE_TIMES}
          windowStartMs={0}
          windowEndMs={24 * 60 * 60 * 1000}
          ariaLabel="Antwortzeit-Verlauf"
          axisLabels={{ start: "vor 24h", mid: "vor 12h", end: "jetzt" }}
        />
      </SectionCard>

      <SectionCard title="Status-Tones" action={<ProgressBar value={0.65} className="w-40" />}>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="ok">operational</StatusBadge>
          <StatusBadge tone="warn">degraded</StatusBadge>
          <StatusBadge tone="bad">partial outage</StatusBadge>
          <StatusBadge tone="critical">major outage</StatusBadge>
          <StatusBadge tone="muted">maintenance</StatusBadge>
        </div>
      </SectionCard>

      <SectionCard
        title="Tilgungsmodell"
        action={
          <ModeSwitch
            value={mode}
            onChange={setMode}
            options={[
              { value: "annuity", label: "Annuität" },
              { value: "fixed", label: "Feste Rate" },
            ]}
          />
        }
      >
        <DetailList
          rows={[
            { label: "Modell", value: mode === "annuity" ? "Annuität" : "Feste Rate" },
            { label: "Sollzins", value: "3,1 %" },
            { label: "Status", value: <StatusBadge tone="ok">aktiv</StatusBadge> },
          ]}
        />
      </SectionCard>

      <CollapsibleSection title="Erweiterte Einstellungen">
        <EmptyState
          title="Noch keine Sondertilgungen"
          description="Lege die erste an, um den Plan zu verkürzen."
        />
      </CollapsibleSection>

      <SectionCard
        title="Drawer"
        action={<Button onClick={() => setDrawerOpen(true)}>Öffnen</Button>}
      >
        <DetailList rows={[{ label: "Status", value: drawerOpen ? "offen" : "geschlossen" }]} />
      </SectionCard>
      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Nachricht"
        description="William Smith · 09:34"
        footer={<Button onClick={() => setDrawerOpen(false)}>Schließen</Button>}
        testId="drawer-demo"
      >
        <p className="text-sm">Hi team, just a reminder about our meeting tomorrow at 10 AM.</p>
      </Drawer>

      <InboxDemo />
      <FinancingCalculatorDemo />
      <FormFieldsDemo />
      <ComparisonDemo />
      <AiTextDemo />
    </div>
  );
}

type InboxMessage = {
  readonly id: string;
  readonly sender: string;
  readonly subject: string;
  readonly snippet: string;
  readonly unread: boolean;
};
type InboxPage = { readonly rows: readonly InboxMessage[]; readonly nextCursor: string | null };

// Inbox-artige Scroll-Liste: Filter (Unread-Toggle + Suche) + Row-Action
// (Archivieren, no-op wie die anderen Demo-Buttons hier). Klick auf eine Zeile
// zeigt die Nachricht im rechten Panel — Split via Resizable, wie das
// Listen/Lese-Paar in echten Mail-Clients (ziehbarer Handle dazwischen statt
// eines OS-Resize-Griffs).
function InboxDemo(): ReactNode {
  const { Button } = usePrimitives();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<InboxMessage | null>(null);
  return (
    <SectionCard
      title="Inbox (InfinityList)"
      action={
        <div className="flex items-center gap-2">
          <ModeSwitch
            value={unreadOnly ? "unread" : "all"}
            onChange={(v) => setUnreadOnly(v === "unread")}
            options={[
              { value: "all", label: "Alle" },
              { value: "unread", label: "Ungelesen" },
            ]}
          />
          <Button variant="secondary" onClick={() => {}}>
            Alle als gelesen markieren
          </Button>
        </div>
      }
    >
      <TextField
        label="Suchen"
        id="inbox-search"
        name="inbox-search"
        value={search}
        onChange={setSearch}
        placeholder="Absender oder Betreff…"
      />
      <ResizablePanelGroup orientation="horizontal" className="mt-3 h-96 rounded-lg border">
        <ResizablePanel defaultSize="35" minSize="25" className="overflow-y-auto">
          <InfinityList<InboxPage, InboxMessage>
            query="widgets:query:metrics:inbox-messages"
            payload={{ unreadOnly, search }}
            pageSize={6}
            rows={(data) => data.rows}
            nextCursor={(data) => data.nextCursor}
            rowId={(row) => row.id}
            testId="inbox-demo"
            renderRow={(row) => (
              <div
                className={`flex items-start justify-between gap-4 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50 ${
                  selected?.id === row.id ? "bg-muted" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className={row.unread ? "font-semibold" : ""}>
                    {row.sender} · {row.subject}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">{row.snippet}</div>
                </button>
                <Button variant="secondary" size="sm" onClick={() => {}}>
                  Archivieren
                </Button>
              </div>
            )}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="65" minSize="30" className="overflow-y-auto p-4">
          {selected === null ? (
            <EmptyState title="Keine Nachricht ausgewählt" description="Zeile links anklicken." />
          ) : (
            <div>
              <div className="font-semibold">{selected.sender}</div>
              <div className="text-sm text-muted-foreground">{selected.subject}</div>
              <p className="mt-4 text-sm">{selected.snippet}</p>
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </SectionCard>
  );
}

// Ghost-Text-Completion + Correct/Translate/Rewrite-Toolbar. Server-Handler
// hier ist eine handgerollte Demo-Feature (ai-text-demo.ts, canned strings),
// nicht die echte Enterprise-Feature — kumiko-framework darf kumiko-enterprise
// nicht importieren. Titel-Feld ist bewusst mit einem Wert vorbelegt, der die
// Box-Breite überschreitet (Ghost-Overlay-Scroll-Sync), die Notiz-Textarea
// mit mehr Zeilen als sichtbar sind (vertikaler Scroll-Sync).
const LONG_TITLE =
  "Ein Titel, der bewusst deutlich breiter ist als das Eingabefeld, damit horizontales Scrollen den Ghost-Text testet";
const LONG_NOTE = Array.from(
  { length: 12 },
  (_, i) => `Zeile ${i + 1} der Notiz — Lorem ipsum dolor sit amet.`,
).join("\n");

function AiTextDemo(): ReactNode {
  const [title, setTitle] = useState(LONG_TITLE);
  const [note, setNote] = useState(LONG_NOTE);
  return (
    <SectionCard title="AI-Text" subtitle="Ghost-Text-Completion, Correct, Translate, Rewrite">
      <AiTextField
        id="ai-text-title"
        name="title"
        label="Titel"
        value={title}
        onChange={setTitle}
      />
      <AiTextArea
        id="ai-text-note"
        name="note"
        label="Notiz"
        value={note}
        onChange={setNote}
        rows={4}
      />
    </SectionCard>
  );
}

// Feld-Widgets für Nicht-Zahl-Typen (Select/Date/Text/Boolean/Textarea) —
// wrappen dieselben usePrimitives-Input-kinds wie NumberField.
interface FieldsDraft {
  readonly land: string;
  readonly datum: string;
  readonly name: string;
  readonly aktiv: boolean;
  readonly notiz: string;
  readonly abruf: number;
}

const FIELDS_DEFAULTS: FieldsDraft = {
  land: "NW",
  datum: "2026-07-10",
  name: "",
  aktiv: true,
  notiz: "",
  abruf: 40,
};

function FormFieldsDemo(): ReactNode {
  const { draft, field } = useDraft<FieldsDraft>(FIELDS_DEFAULTS);
  const { Button } = usePrimitives();
  return (
    <SectionCard title="Feld-Widgets">
      <TextField label="Name" {...field("name")} placeholder="z. B. Variante A" />
      <SelectField
        label="Bundesland"
        {...field("land")}
        options={[
          { value: "NW", label: "Nordrhein-Westfalen" },
          { value: "BY", label: "Bayern" },
        ]}
      />
      <DateField label="Datum" {...field("datum")} />
      <BooleanField label="Makler einbeziehen" {...field("aktiv")} />
      <RangeField
        label={`Abruf: ${draft.abruf} %`}
        {...field("abruf")}
        min={0}
        max={100}
        step={5}
      />
      <TextareaField label="Notiz" {...field("notiz")} rows={3} />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => {}}>
          Klein
        </Button>
        <Button onClick={() => {}}>Standard</Button>
      </div>
    </SectionCard>
  );
}

// Transponierter Vergleich (Zeile = Kennzahl, Spalte = Variante), beste
// hervorgehoben — für Szenario-/Angebotsvergleiche.
function ComparisonDemo(): ReactNode {
  const euro = (n: number): string => `${n.toLocaleString("de-DE")} €`;
  const scenarios = [
    { name: "A", rate: 890, interest: 84000 },
    { name: "B", rate: 940, interest: 71000 },
  ];
  const minIndex = (pick: (s: (typeof scenarios)[number]) => number): number => {
    let bestI = 0;
    let bestV = Number.POSITIVE_INFINITY;
    scenarios.forEach((s, i) => {
      const v = pick(s);
      if (v < bestV) {
        bestV = v;
        bestI = i;
      }
    });
    return bestI;
  };
  return (
    <SectionCard title="Vergleich">
      <ComparisonTable
        columns={scenarios}
        columnHeader={(s) => s.name}
        columnKey={(s) => s.name}
        metricLabel="Kennzahl"
        metrics={[
          {
            label: "Monatsrate",
            value: (s) => euro(s.rate),
            bestIndex: () => minIndex((s) => s.rate),
          },
          {
            label: "Gesamtzins",
            value: (s) => euro(s.interest),
            bestIndex: () => minIndex((s) => s.interest),
          },
        ]}
      />
    </SectionCard>
  );
}

// Live-Input-Rechner: useDraft → pure Berechnung → ResultPanel/ResultTable.
// Belegt, dass das Form-Kit das Rechner-Muster der Apps ohne Custom-CSS trägt.
interface CalcDraft {
  readonly sum: number | undefined;
  readonly interest: number | undefined;
  readonly repayment: number | undefined;
}

const CALC_DEFAULTS: CalcDraft = { sum: 300000, interest: 3.8, repayment: 2 };

function FinancingCalculatorDemo(): ReactNode {
  const { draft, field } = useDraft<CalcDraft>(CALC_DEFAULTS);
  const ready = draft.sum !== undefined && draft.interest !== undefined;
  const rate = ready
    ? Math.round((draft.sum * ((draft.interest + (draft.repayment ?? 0)) / 100)) / 12)
    : 0;
  const euro = (n: number): string => `${n.toLocaleString("de-DE")} €`;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Finanzierung">
        <MoneyField label="Darlehen" {...field("sum")} required />
        <PercentField label="Sollzins" {...field("interest")} required />
        <PercentField label="Tilgung" {...field("repayment")} />
      </SectionCard>
      <ResultPanel
        title="Ergebnis"
        empty={!ready}
        emptyText="Darlehen und Zins eingeben."
        rows={[
          { label: "Darlehen", value: euro(draft.sum ?? 0) },
          { label: "Monatsrate", value: euro(rate), emphasize: true },
        ]}
      >
        <ResultTable
          columns={[
            { header: "Tranche", cell: (r: { label: string; rate: number }) => r.label },
            { header: "Rate", align: "right", cell: (r) => euro(r.rate) },
          ]}
          rows={[{ label: "Bankdarlehen", rate }]}
          rowKey={(r) => r.label}
        />
      </ResultPanel>
    </div>
  );
}
