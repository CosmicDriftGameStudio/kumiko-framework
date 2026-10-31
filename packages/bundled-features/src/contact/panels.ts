import type { DashboardStatPanel } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  CONTACT_FEATURE,
  CONTACT_STATUS,
  ContactQueries,
  ContactScreens,
} from "./web/constants.ts";

// Stat tile for a dashboard: how many contact requests still wait for a first answer.
export function contactOpenRequestsPanels(): readonly DashboardStatPanel[] {
  return [
    {
      kind: "stat",
      id: `${CONTACT_FEATURE}-open-requests`,
      label: "contact:overview.open",
      query: ContactQueries.requestList,
      params: {
        filters: [{ field: "status", op: "eq", value: CONTACT_STATUS.Open }],
        limit: 1,
        totalCount: true,
      },
      ignoreScreenFilter: true,
      valueField: "total",
      tone: "warn",
      navigate: { screen: ContactScreens.requestList },
    },
  ];
}
