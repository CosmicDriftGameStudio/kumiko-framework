// @runtime client
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { DELIVERY_FEATURE, DELIVERY_STATUS_CELL_COMPONENT } from "../public-names";
import { DeliveryStatusCell } from "./delivery-status-cell";

export type DeliveryClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function deliveryClient(options?: DeliveryClientOptions): ClientFeatureDefinition {
  return {
    name: DELIVERY_FEATURE,
    columnRenderers: {
      [DELIVERY_STATUS_CELL_COMPONENT]: DeliveryStatusCell,
    },
    ...(options?.translations !== undefined && { translations: options.translations }),
  };
}
