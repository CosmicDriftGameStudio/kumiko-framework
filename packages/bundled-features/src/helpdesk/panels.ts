import type { DashboardStatPanel } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  HELPDESK_FEATURE,
  HELPDESK_STATUS,
  HelpdeskQueries,
  HelpdeskScreens,
} from "./web/constants.ts";

// Stat tile for a dashboard: how many contact requests still wait for a first answer.
export function helpdeskOpenRequestsPanels(): readonly DashboardStatPanel[] {
  return [
    {
      kind: "stat",
      id: `${HELPDESK_FEATURE}-open-requests`,
      label: "helpdesk:overview.open",
      query: HelpdeskQueries.requestList,
      params: {
        filters: [{ field: "status", op: "eq", value: HELPDESK_STATUS.Open }],
        limit: 1,
        totalCount: true,
      },
      ignoreScreenFilter: true,
      valueField: "total",
      tone: "warn",
      navigate: { screen: HelpdeskScreens.requestList },
    },
  ];
}
