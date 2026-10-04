// @runtime client
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import {
  DELIVERY_CHANNEL_CELL_COMPONENT,
  DELIVERY_ERROR_CELL_COMPONENT,
  DELIVERY_FEATURE,
  DELIVERY_STATUS_CELL_COMPONENT,
  DELIVERY_TIME_CELL_COMPONENT,
  DELIVERY_TYPE_CELL_COMPONENT,
} from "../public-names.js";
import { DeliveryChannelCell } from "./delivery-channel-cell.js";
import { DeliveryErrorCell } from "./delivery-error-cell.js";
import { DeliveryStatusCell } from "./delivery-status-cell.js";
import { DeliveryTimeCell } from "./delivery-time-cell.js";
import { DeliveryTypeCell } from "./delivery-type-cell.js";

export type DeliveryClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function deliveryClient(options?: DeliveryClientOptions): ClientFeatureDefinition {
  return {
    name: DELIVERY_FEATURE,
    columnRenderers: {
      [DELIVERY_STATUS_CELL_COMPONENT]: DeliveryStatusCell,
      [DELIVERY_TYPE_CELL_COMPONENT]: DeliveryTypeCell,
      [DELIVERY_CHANNEL_CELL_COMPONENT]: DeliveryChannelCell,
      [DELIVERY_TIME_CELL_COMPONENT]: DeliveryTimeCell,
      [DELIVERY_ERROR_CELL_COMPONENT]: DeliveryErrorCell,
    },
    ...(options?.translations !== undefined && { translations: options.translations }),
  };
}
