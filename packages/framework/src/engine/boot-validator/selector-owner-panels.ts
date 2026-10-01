import type { FeatureDefinition } from "../types/index.js";
import { buildQueryHandlerMap } from "./projection-list-screens.js";
import { checkQueryRef } from "./query-refs.js";
import { validateDashboardCustomPanel, validateDashboardScreenPanel } from "./screens.js";

// Owner panels are merged into a dashboard that is built after boot, so the screen and
// query refs are checked here against the registered features instead.
export function validateExtensionSelectorPanels(features: readonly FeatureDefinition[]): void {
  const featureMap = new Map(features.map((feature) => [feature.name, feature]));
  const queryHandlers = buildQueryHandlerMap(features);
  for (const feature of features) {
    for (const selector of feature.extensionSelectors ?? []) {
      const where = `extensionSelector("${selector.extensionName}")`;
      for (const panel of selector.panels ?? []) {
        const context = `[Feature ${feature.name}] ${where} panel "${panel.id}"`;
        if (panel.kind === "custom") {
          validateDashboardCustomPanel(feature.name, where, panel);
          continue;
        }
        validateDashboardScreenPanel(feature.name, where, panel, featureMap);
        if (panel.visibleWhen !== undefined) {
          checkQueryRef(queryHandlers, panel.visibleWhen.query, () => `${context} visibleWhen`);
        }
      }
    }
  }
}
