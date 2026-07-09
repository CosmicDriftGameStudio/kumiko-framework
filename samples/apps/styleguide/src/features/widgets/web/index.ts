import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { DashboardFilterEcho } from "./DashboardFilterEcho";
import { DashboardKpiIcon } from "./DashboardKpiIcon";
import { Widgets } from "./Widgets";

export const widgetsClient: ClientFeatureDefinition = {
  name: "widgets",
  components: { widgets: Widgets },
  extensionSectionComponents: {
    "widgets-dashboard-filter-echo": DashboardFilterEcho,
    "widgets-dashboard-kpi-icon": DashboardKpiIcon,
  },
};
