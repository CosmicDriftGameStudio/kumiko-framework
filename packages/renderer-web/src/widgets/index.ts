// Mid-Level-Widgets — Kompositionen über den Primitives (Card, DataTable,
// Banner) + Theme-Tokens. Für Custom-Screens: erst hier schauen, dann bauen.
// Katalog: docs.kumiko.rocks → Guides → Widgets; visueller Überblick im
// styleguide-Sample.

export {
  AiTextArea,
  type AiTextAreaProps,
  AiTextField,
  type AiTextFieldProps,
} from "./ai-text-field.tsx";
export type {
  StackedAreaDateFormat,
  StackedAreaInitialWindow,
  StackedAreaRangeOption,
  StackedAreaRanges,
  StackedAreaWindowSelection,
} from "./chart-window.ts";
export {
  type ChartMarker,
  type ChartSeries,
  type ChartTone,
  SegmentBarChart,
  type SegmentBarRow,
  StackedAreaChart,
  StackedBarChart,
  StatusBarChart,
  type StatusBarEntry,
  smoothPath,
  TimeseriesChart,
  type TimeseriesHeight,
  type TimeseriesPoint,
  type TimeseriesReferenceLine,
  type TimeseriesXAxis,
  type TimeseriesYAxis,
} from "./charts.tsx";
export { CollapsibleSection } from "./collapsible-section.tsx";
export { type DashboardListColumn, DashboardListTable } from "./dashboard-list.tsx";
export { DetailList } from "./detail-list.tsx";
export { Drawer, type DrawerProps } from "./drawer.tsx";
export { FeedList, type FeedRow } from "./feed-list.tsx";
export {
  FloatingPanel,
  type FloatingPanelGeometry,
  type FloatingPanelProps,
} from "./floating-panel.tsx";
export {
  BooleanField,
  type BooleanFieldProps,
  DateField,
  type DateFieldProps,
  FileField,
  type FileFieldProps,
  MoneyField,
  NumberField,
  type NumberFieldProps,
  PercentField,
  RangeField,
  type RangeFieldProps,
  SelectField,
  type SelectFieldProps,
  TextareaField,
  type TextareaFieldProps,
  TextField,
  type TextFieldProps,
} from "./form-fields.tsx";
export {
  InfinityList,
  type InfinityListProps,
  type InfinityListSelection,
} from "./infinity-list.tsx";
export { ModeSwitch, type ModeSwitchVariant } from "./mode-switch.tsx";
export { type PhotoSlotSpec, PhotoSlots, type PhotoSlotsProps } from "./photo-slots.tsx";
export {
  PlanCard,
  type PlanCardActionSlot,
  type PlanCardPrice,
  type PlanCardProps,
  PlanGrid,
  type PlanGridProps,
} from "./plan-card.tsx";
export { ProgressBar } from "./progress-bar.tsx";
export { ProgressList, type ProgressListRow } from "./progress-list.tsx";
export { PublicShell, type PublicShellProps, type PublicShellVariant } from "./public-shell.tsx";
export { QueryTable, type QueryTableColumn, type QueryTableProps } from "./query-table.tsx";
export {
  type ComparisonMetric,
  ComparisonTable,
  type ResultColumn,
  ResultPanel,
  ResultTable,
} from "./result-panel.tsx";
export { SectionCard } from "./section-card.tsx";
export {
  SideBySideTable,
  type SideBySideTableCell,
  type SideBySideTableColumn,
  type SideBySideTableRow,
} from "./side-by-side-table.tsx";
export {
  MiniStat,
  Sparkline,
  StatCard,
  type StatDelta,
  StatStripCell,
  type StatTone,
} from "./stat.tsx";
export { EmptyState, ErrorState, LoadingState } from "./states.tsx";
export {
  STATUS_TONE_TEXT,
  StatusBadge,
  type StatusBadgeTone,
  type StatusTone,
} from "./status-badge.tsx";
export { StepBar } from "./step-bar.tsx";
export { UploadZone, type UploadZoneProps } from "./upload-zone.tsx";
export { useDraft } from "./use-draft.ts";
