// Visueller Katalog des Widget-Kits — jede Sektion zeigt ein Widget mit
// statischen Daten. Dient zugleich als e2e-Renderfläche (content.spec).

import {
  CollapsibleSection,
  DetailList,
  EmptyState,
  MiniStat,
  ModeSwitch,
  ProgressBar,
  SectionCard,
  StatCard,
  StatusBadge,
  StatusBarChart,
  TimeseriesChart,
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
    </div>
  );
}
