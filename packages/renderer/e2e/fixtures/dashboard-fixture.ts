// Debt-dashboard fixture (CashColt look-alike) for the mobile-overflow spec:
// KPI strip, wide stacked-area chart with range pills + brush + marker legend,
// labeled stat groups, feed, progress list and a four-column list.
// All data is static so layout measurements are reproducible.

import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";

export const DASHBOARD_SCREEN_ID = "debt-dashboard";
export const DASHBOARD_PATH = `/${DASHBOARD_SCREEN_ID}`;

const EUR = { kind: "currency", currency: "EUR" } as const;

function query(name: string): string {
  return `test:query:dash-${name}`;
}

export const dashboardScreen: DashboardScreenDefinition = {
  id: DASHBOARD_SCREEN_ID,
  type: "dashboard",
  dormant: true,
  showUpdatedAt: false,
  panels: [
    {
      kind: "stat-group",
      id: "kpi",
      stats: [
        {
          kind: "stat",
          id: "kpi-remaining",
          label: "Restschuld heute",
          query: query("kpi-remaining"),
          valueField: "value",
          subField: "sub",
          valueFormat: EUR,
          deltaField: "delta",
          deltaDirectionField: "direction",
        },
        {
          kind: "stat",
          id: "kpi-rate",
          label: "Monatsrate gesamt",
          query: query("kpi-rate"),
          valueField: "value",
          valueFormat: EUR,
        },
        {
          kind: "stat",
          id: "kpi-interest",
          label: "Zinsen gesamt",
          query: query("kpi-interest"),
          valueField: "value",
          valueFormat: EUR,
          tone: "negative",
        },
        {
          kind: "stat",
          id: "kpi-debt-free",
          label: "Schuldenfrei bis",
          query: query("kpi-debt-free"),
          valueField: "value",
          subField: "sub",
        },
        {
          kind: "stat",
          id: "kpi-loans",
          label: "Kredite",
          query: query("kpi-loans"),
          valueField: "value",
        },
      ],
    },
    {
      kind: "chart",
      id: "chart",
      chart: "stacked-area",
      label: "Restschuld, Tilgung & Zinsen",
      subtitle:
        "Wie sich die Gesamt-Restschuld aller Kredite über die Zeit in getilgtes Kapital und gezahlte Zinsen aufteilt.",
      query: query("chart"),
      valueFormat: EUR,
      brush: true,
      markerLegend: "legend",
      markerLabels: true,
      legendTotals: false,
      ranges: {
        default: "max",
        options: [
          { value: "y1", label: "1 J", months: 12 },
          { value: "y3", label: "3 J", months: 36 },
          { value: "y5", label: "5 J", months: 60 },
          { value: "max", label: "Max" },
        ],
      },
      seriesColors: {
        remaining: "#c2410c",
        repaid: "#15803d",
        interest: "#b91c1c",
        rent: "#1d4ed8",
        rentMin: "#6b7280",
      },
      markerKinds: {
        additional: { color: "#7c3aed", label: "Sondertilgung" },
        allotment: { color: "#0891b2", label: "Zuteilung" },
        payoff: { color: "#15803d", label: "Abbezahlt" },
      },
    },
    {
      kind: "stat-group",
      id: "networth",
      label: "Netto-Vermögen",
      subtitle:
        "Vermögenswerte abzüglich aller offenen Kreditsalden, bewertet zum aktuellen Marktwert der beliehenen Objekte.",
      span: "half",
      stats: [
        {
          kind: "stat",
          id: "nw-assets",
          label: "Vermögen",
          query: query("nw-assets"),
          valueField: "value",
          valueFormat: EUR,
        },
        {
          kind: "stat",
          id: "nw-debts",
          label: "Schulden",
          query: query("nw-debts"),
          valueField: "value",
          valueFormat: EUR,
        },
        {
          kind: "stat",
          id: "nw-net",
          label: "Netto",
          query: query("nw-net"),
          valueField: "value",
          valueFormat: EUR,
        },
      ],
    },
    {
      kind: "stat-group",
      id: "cashflow",
      label: "Miet-Cashflow",
      subtitle: "Mieteinnahmen gegenüber den monatlichen Raten der vermieteten Objekte.",
      span: "half",
      stats: [
        {
          kind: "stat",
          id: "cf-rent",
          label: "Mieteinnahmen",
          query: query("cf-rent"),
          valueField: "value",
          valueFormat: EUR,
        },
        {
          kind: "stat",
          id: "cf-balance",
          label: "Saldo",
          query: query("cf-balance"),
          valueField: "value",
          valueFormat: EUR,
        },
      ],
    },
    {
      kind: "feed",
      id: "appointments",
      label: "Nächste Termine",
      query: query("appointments"),
    },
    {
      kind: "progress-list",
      id: "progress",
      label: "Tilgungs-Fortschritt",
      query: query("progress"),
    },
    {
      kind: "list",
      id: "loans",
      label: "Kredite",
      query: query("loans"),
      span: "half",
      columns: [
        { field: "name", label: "Kredit" },
        { field: "remaining", label: "Restschuld" },
        { field: "rate", label: "Rate" },
        { field: "interest", label: "Zinssatz" },
      ],
    },
  ],
};

function utcMs(year: number, monthIndex: number): number {
  return Date.UTC(year, monthIndex, 1);
}

const CENTS = 100;
const INITIAL_DEBT_CENTS = 870_000 * CENTS;
const TOTAL_INTEREST_CENTS = 389_000 * CENTS;
const TOTAL_RENT_CENTS = 600_000 * CENTS;
const RENT_MIN_SHARE = 0.8;
const CURVE_EXPONENT = 1.3;

function chartData(): unknown {
  const start = utcMs(2023, 6);
  const end = utcMs(2048, 3);
  const bucketCount = (2048 - 2023) * 12 + (3 - 6) + 1;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    atMs: utcMs(2023, 6 + i),
    progress: i / (bucketCount - 1),
  }));
  const remaining = buckets.map(({ atMs, progress }) => ({
    atMs,
    value: Math.round(INITIAL_DEBT_CENTS * (1 - progress ** CURVE_EXPONENT)),
  }));
  const repaid = remaining.map(({ atMs, value }) => ({ atMs, value: INITIAL_DEBT_CENTS - value }));
  const interest = buckets.map(({ atMs, progress }) => ({
    atMs,
    value: Math.round(TOTAL_INTEREST_CENTS * progress),
  }));
  const rent = buckets.map(({ atMs, progress }) => ({
    atMs,
    value: Math.round(TOTAL_RENT_CENTS * progress),
  }));
  const rentMin = rent.map(({ atMs, value }) => ({
    atMs,
    value: Math.round(value * RENT_MIN_SHARE),
  }));
  const payoff = (year: number, month: number, label: string) => ({
    atMs: utcMs(year, month - 1),
    label,
    kind: "payoff",
  });
  return {
    windowStartMs: start,
    windowEndMs: end,
    todayMs: utcMs(2026, 9),
    series: [
      { key: "remaining", label: "Restschuld", points: remaining },
      { key: "repaid", label: "Getilgt", points: repaid },
      { key: "interest", label: "Zinsen", points: interest },
    ],
    lines: [
      { key: "rent", label: "Miete kumuliert", points: rent },
      { key: "rentMin", label: "Miete (Minimum)", points: rentMin, dashed: true },
    ],
    markers: [
      payoff(2027, 4, "Zwischenfinanzierung abbezahlt"),
      { atMs: utcMs(2030, 9), label: "Bauspar-Zuteilung", kind: "allotment" },
      payoff(2031, 11, "Autokredit abbezahlt"),
      payoff(2033, 6, "Modernisierungskredit abbezahlt"),
      payoff(2044, 2, "KfW-Förderkredit abbezahlt"),
      payoff(2045, 2, "Sanierungsdarlehen abbezahlt"),
      payoff(2048, 4, "Baufinanzierung abbezahlt"),
    ],
  };
}

const statResponses: Readonly<Record<string, unknown>> = {
  "kpi-remaining": {
    value: 739_500 * CENTS,
    sub: "15 % getilgt",
    delta: "15 %",
    direction: "down",
  },
  "kpi-rate": { value: 4_120 * CENTS },
  "kpi-interest": { value: 389_000 * CENTS },
  "kpi-debt-free": { value: "04/2048", sub: "noch 21 Jahre 6 Monate" },
  "kpi-loans": { value: 7 },
  "nw-assets": { value: 1_150_000 * CENTS },
  "nw-debts": { value: 739_500 * CENTS },
  "nw-net": { value: 410_500 * CENTS },
  "cf-rent": { value: 3_200 * CENTS },
  "cf-balance": { value: -920 * CENTS },
};

const panelResponses: Readonly<Record<string, unknown>> = {
  appointments: {
    rows: [
      { primary: "Sondertilgung Baufinanzierung", trailing: "15.11.2026" },
      { primary: "Zinsbindung Autokredit endet", trailing: "01.03.2027" },
      { primary: "Zuteilung Bausparvertrag", trailing: "01.10.2030" },
      { primary: "Anschlussfinanzierung prüfen", trailing: "01.01.2031" },
      { primary: "Letzte Rate Zwischenfinanzierung", trailing: "01.04.2027" },
    ],
  },
  progress: {
    rows: [
      { label: "Baufinanzierung", value: "12 %", fraction: 0.12, sub: "noch 21 Jahre 6 Monate" },
      {
        label: "Modernisierungskredit",
        value: "48 %",
        fraction: 0.48,
        sub: "noch 6 Jahre 8 Monate",
      },
      { label: "Autokredit", value: "71 %", fraction: 0.71, sub: "noch 5 Jahre 1 Monat" },
    ],
  },
  loans: {
    rows: [
      { name: "Baufinanzierung", remaining: "512.300,00 €", rate: "2.310,00 €", interest: "3,4 %" },
      { name: "KfW-Förderkredit", remaining: "98.000,00 €", rate: "480,00 €", interest: "1,2 %" },
      { name: "Sanierungsdarlehen", remaining: "64.200,00 €", rate: "350,00 €", interest: "2,9 %" },
      {
        name: "Modernisierungskredit",
        remaining: "41.000,00 €",
        rate: "540,00 €",
        interest: "4,1 %",
      },
    ],
  },
};

/** Answers a dashboard fixture query; `undefined` for any other query name. */
export function dashboardQueryResponse(qn: string): unknown {
  const prefix = query("");
  if (!qn.startsWith(prefix)) return undefined;
  const name = qn.slice(prefix.length);
  if (name === "chart") return chartData();
  return statResponses[name] ?? panelResponses[name];
}
