// @runtime client
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import {
  CAP_CARDS_PANEL_COMPONENT,
  CAP_OVERVIEW_FEATURE,
  CAP_USAGE_CELL_COMPONENT,
} from "../constants";
import { CapCardsPanel } from "./cap-cards-panel";
import { CapUsageCell } from "./cap-usage-cell";

export type CapOverviewClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function capOverviewClient(options?: CapOverviewClientOptions): ClientFeatureDefinition {
  return {
    name: CAP_OVERVIEW_FEATURE,
    columnRenderers: {
      [CAP_USAGE_CELL_COMPONENT]: CapUsageCell,
    },
    extensionSectionComponents: {
      [CAP_CARDS_PANEL_COMPONENT]: CapCardsPanel,
    },
    ...(options?.translations !== undefined && { translations: options.translations }),
  };
}
