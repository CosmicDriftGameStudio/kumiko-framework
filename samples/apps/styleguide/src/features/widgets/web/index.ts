import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { Widgets } from "./Widgets";

export const widgetsClient: ClientFeatureDefinition = {
  name: "widgets",
  components: { widgets: Widgets },
};
