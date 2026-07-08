// Mid-Level-Widgets — Kompositionen über den Primitives (Card, DataTable,
// Banner) + Theme-Tokens. Für Custom-Screens: erst hier schauen, dann bauen.
// Katalog: docs.kumiko.rocks → Guides → Widgets; visueller Überblick im
// styleguide-Sample.

export { StatusBadge, STATUS_TONE_TEXT, type StatusTone } from "./status-badge";
export { SectionCard } from "./section-card";
export { StatCard, MiniStat, Sparkline, type StatTone, type StatDelta } from "./stat";
export { CollapsibleSection } from "./collapsible-section";
export { DetailList } from "./detail-list";
export { ModeSwitch } from "./mode-switch";
export { ProgressBar } from "./progress-bar";
export {
  StatusBarChart,
  TimeseriesChart,
  smoothPath,
  type StatusBarEntry,
  type TimeseriesPoint,
} from "./charts";
export { EmptyState, ErrorState, LoadingState } from "./states";
export { QueryTable, type QueryTableColumn, type QueryTableProps } from "./query-table";
