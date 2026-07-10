// Visueller Katalog des Widget-Kits — jede Sektion zeigt ein Widget mit
// statischen Daten. Dient zugleich als e2e-Renderfläche (content.spec).

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import {
  BooleanField,
  CollapsibleSection,
  ComparisonTable,
  DateField,
  DetailList,
  EmptyState,
  MiniStat,
  ModeSwitch,
  MoneyField,
  PercentField,
  ProgressBar,
  RangeField,
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

      <FinancingCalculatorDemo />
      <FormFieldsDemo />
      <ComparisonDemo />
    </div>
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
  const { draft, patch, field } = useDraft<FieldsDraft>(FIELDS_DEFAULTS);
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
      <DateField label="Datum" {...field("datum")} onChange={(v) => patch({ datum: v ?? "" })} />
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
