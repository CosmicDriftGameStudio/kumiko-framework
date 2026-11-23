import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { readerRoles } from "./access";

// Design options: all opt-in, a dashboard without them renders as before.
export function createTicketDesignScreen(designQuery: string): ScreenDefinition {
  return {
    id: "ticket-design",
    type: "dashboard",
    // The screen title (`screen:ticket-design.title`) as page heading, the subtitle from the query below it.
    showTitle: true,
    headerSubtitle: { query: designQuery, field: "subtitle" },
    layout: "main-side",
    // Side column two fifths wide instead of one third.
    sideWidth: "wide",
    panels: [
      {
        // Separate cards without the outer frame; the sub line takes its tone from the answer.
        kind: "stat-group",
        id: "kpis",
        framed: false,
        layout: "cards",
        column: "top",
        stats: [
          {
            kind: "stat",
            id: "opened",
            label: "tickets.design.opened",
            query: designQuery,
            resultField: "kpis",
            valueField: "opened",
            subField: "openedSub",
            subToneField: "openedSubTone",
          },
          {
            kind: "stat",
            id: "escalated",
            label: "tickets.design.escalated",
            query: designQuery,
            resultField: "kpis",
            valueField: "escalated",
            subField: "escalatedSub",
            subToneField: "escalatedSubTone",
          },
        ],
      },
      {
        kind: "chart",
        id: "weekly",
        label: "tickets.design.weekly",
        chart: "stacked-bars",
        query: designQuery,
        resultField: "weekly",
        seriesTones: { opened: "active" },
        barValueLabels: true,
        highlightLast: true,
        hideYAxis: true,
        hideLegend: true,
        labelEveryBucket: true,
        lastBucketLabel: "date",
      },
      {
        kind: "chart",
        id: "by-team",
        label: "tickets.design.by-team",
        chart: "segment-bars",
        query: designQuery,
        resultField: "byTeam",
        column: "side",
        // One line per row; every segment in one tone, for segment keys the screen cannot name.
        layout: "rows",
        singleTone: "active",
        hideLegend: true,
      },
    ],
    access: readerRoles,
  };
}
