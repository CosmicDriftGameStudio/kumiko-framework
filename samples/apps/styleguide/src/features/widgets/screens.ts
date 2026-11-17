import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";

export const widgetsDashboardScreen: ScreenDefinition = {
  id: "widgets-dashboard",
  type: "dashboard",
  filter: {
    id: "region",
    label: "widgets:dashboard:filter-region",
    kind: "select",
    options: [
      { value: "eu", label: "widgets:dashboard:filter-region-eu" },
      { value: "us", label: "widgets:dashboard:filter-region-us" },
    ],
  },
  panels: [
    {
      kind: "stat",
      id: "portfolio",
      label: "widgets:dashboard:portfolio",
      query: "widgets:query:metrics:portfolio-stat",
      valueField: "value",
      subField: "sub",
      toneField: "tone",
      deltaField: "delta",
      deltaDirectionField: "deltaDirection",
      deltaToneField: "deltaTone",
      icon: { react: { __component: "widgets-dashboard-kpi-icon" } },
      accentColor: "var(--color-primary)",
    },
    {
      kind: "stat-group",
      id: "net-worth",
      label: "widgets:dashboard:net-worth",
      stats: [
        {
          kind: "stat",
          id: "net-worth-assets",
          label: "widgets:dashboard:net-worth-assets",
          query: "widgets:query:metrics:net-worth-assets",
          valueField: "value",
        },
        {
          kind: "stat",
          id: "net-worth-debts",
          label: "widgets:dashboard:net-worth-debts",
          query: "widgets:query:metrics:net-worth-debts",
          valueField: "value",
        },
      ],
    },
    {
      kind: "chart",
      id: "response-times",
      label: "widgets:dashboard:response-times",
      chart: "timeseries",
      query: "widgets:query:metrics:response-times",
    },
    {
      kind: "chart",
      id: "loan",
      label: "widgets:dashboard:loan",
      chart: "stacked-area",
      query: "widgets:query:metrics:loan",
      valueFormat: { kind: "currency", currency: "EUR", fractionDigits: 0 },
      brush: true,
      legendTotals: false,
      initialWindow: "from-today",
      markerLegend: "legend",
      markerLabels: true,
      markerKinds: {
        extra: { tone: "active", label: "widgets:dashboard:kind-extra" },
        payoff: { tone: "positive", label: "widgets:dashboard:kind-payoff" },
      },
      ranges: {
        default: "max",
        options: [
          { value: "y1", label: "widgets:dashboard:range-y1", months: 12 },
          { value: "y3", label: "widgets:dashboard:range-y3", months: 36 },
          { value: "y5", label: "widgets:dashboard:range-y5", months: 60 },
          { value: "max", label: "widgets:dashboard:range-all" },
        ],
      },
    },
    {
      kind: "list",
      id: "latest",
      label: "widgets:dashboard:latest",
      query: "widgets:query:metrics:latest-items",
      columns: [
        { field: "name", label: "widgets:dashboard:col-name" },
        { field: "status", label: "widgets:dashboard:col-status" },
      ],
    },
    {
      kind: "feed",
      id: "upcoming",
      label: "widgets:dashboard:upcoming",
      query: "widgets:query:metrics:upcoming-events",
    },
    {
      kind: "progress-list",
      id: "goal-progress",
      label: "widgets:dashboard:goal-progress",
      query: "widgets:query:metrics:goal-progress",
    },
    {
      kind: "text",
      id: "dashboard-help",
      label: "widgets:dashboard:help-title",
      blocks: [
        { kind: "heading", text: "widgets:dashboard:help-heading" },
        { kind: "paragraph", text: "widgets:dashboard:help-body" },
        {
          kind: "list",
          items: ["widgets:dashboard:help-item-1", "widgets:dashboard:help-item-2"],
        },
        { kind: "code", code: "kumiko check --explain" },
        { kind: "hint", text: "widgets:dashboard:help-hint" },
      ],
    },
    {
      kind: "custom",
      id: "filter-echo",
      component: { react: { __component: "widgets-dashboard-filter-echo" } },
    },
  ],
};
