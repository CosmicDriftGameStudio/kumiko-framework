import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { DashboardFilterEcho } from "./DashboardFilterEcho";
import { Widgets } from "./Widgets";

export const widgetsClient: ClientFeatureDefinition = {
  name: "widgets",
  components: { widgets: Widgets },
  extensionSectionComponents: { "widgets-dashboard-filter-echo": DashboardFilterEcho },
};
