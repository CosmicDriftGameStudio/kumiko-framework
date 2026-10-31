import type { BootRuleTable } from "./boot-rule.ts";

export const DASHBOARD_CHART_RULES = {
  chartFromTodayUnreachable: {
    id: "dashboard/chart-from-today-unreachable",
    summary: 'A chart with initialWindow "from-today" has ranges or brush.',
    fix: "Add ranges or brush, or change initialWindow.",
  },
  chartFlagNonBoolean: {
    id: "dashboard/chart-flag-non-boolean",
    summary: "Chart flags (scrollable, brush, legendTotals, markerLabels) are booleans.",
    fix: "Use true or false.",
  },
  chartStackedAreaOnly: {
    id: "dashboard/chart-stacked-area-only",
    summary: 'Stacked-area chart props are only set on a "stacked-area" chart.',
    fix: 'Remove the props or use chart "stacked-area".',
  },
  chartUnitTimeseriesOnly: {
    id: "dashboard/chart-unit-timeseries-only",
    summary: 'A chart unit is only set on a "timeseries" chart.',
    fix: 'Remove unit or use chart "timeseries".',
  },
  chartColorInvalid: {
    id: "dashboard/chart-color-invalid",
    summary: "Chart series and marker colors are non-empty CSS colors.",
    fix: "Set a non-empty CSS color.",
  },
  chartEnumPropInvalid: {
    id: "dashboard/chart-enum-prop-invalid",
    summary: "Stacked-area dateFormat, initialWindow and markerLegend use an allowed value.",
    fix: "Set the prop to one of the allowed values.",
  },
  chartMarkerLookMissing: {
    id: "dashboard/chart-marker-look-missing",
    summary: "A chart marker kind sets a tone or a color.",
    fix: "Set tone or color.",
  },
  chartMarkerToneInvalid: {
    id: "dashboard/chart-marker-tone-invalid",
    summary: "A chart marker tone is a known dashboard tone.",
    fix: "Use positive, negative, active or neutral.",
  },
  chartMarkerLabelInvalid: {
    id: "dashboard/chart-marker-label-invalid",
    summary: "A chart marker label is a non-empty i18n key.",
    fix: "Set a non-empty i18n key or remove label.",
  },
  chartRangesOptionsEmpty: {
    id: "dashboard/chart-ranges-options-empty",
    summary: "Chart ranges declare at least one option.",
    fix: "Add an option to ranges.options.",
  },
  chartRangesOptionIncomplete: {
    id: "dashboard/chart-ranges-option-incomplete",
    summary: "Every chart range option has a non-empty value and label.",
    fix: "Give every option a value and a label.",
  },
  chartRangesOptionDuplicate: {
    id: "dashboard/chart-ranges-option-duplicate",
    summary: "Chart range option values are unique.",
    fix: "Use each option value once.",
  },
  chartRangesMonthsInvalid: {
    id: "dashboard/chart-ranges-months-invalid",
    summary: "A chart range option's months is a positive integer.",
    fix: "Set months to a positive integer or remove it.",
  },
  chartRangesDefaultUnknown: {
    id: "dashboard/chart-ranges-default-unknown",
    summary: "ranges.default is one of the option values.",
    fix: "Set default to one of the options.",
  },
  valueFormatKind: {
    id: "dashboard/value-format-kind",
    summary: "A valueFormat kind is allowed for the panel type.",
    fix: "Use an allowed kind for this panel type.",
  },
  valueFormatCurrency: {
    id: "dashboard/value-format-currency",
    summary: "A currency valueFormat uses a 3-letter uppercase ISO currency code.",
    fix: 'Set currency to an ISO 4217 code such as "EUR".',
  },
  valueFormatFractionDigits: {
    id: "dashboard/value-format-fraction-digits",
    summary: "valueFormat.fractionDigits is an integer from 0 to the maximum.",
    fix: "Set fractionDigits to an integer within range.",
  },
} as const satisfies BootRuleTable;
