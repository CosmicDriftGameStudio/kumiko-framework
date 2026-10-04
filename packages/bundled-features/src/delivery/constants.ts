import type { NotifyPriority } from "@cosmicdrift/kumiko-framework/engine";
import { QnTypes, qn } from "@cosmicdrift/kumiko-framework/engine";
import { DELIVERY_FEATURE, DeliveryJobNames } from "./public-names.js";

// Extension-point name for delivery-channel plugins (channel-email,
// channel-in-app, channel-push, ...).
export const DELIVERY_CHANNEL_EXTENSION = "deliveryChannel" as const;

export {
  DELIVERY_ATTEMPT_EVENT,
  DELIVERY_CHANNEL_CELL_COMPONENT,
  DELIVERY_ERROR_CELL_COMPONENT,
  DELIVERY_FEATURE,
  DELIVERY_LOG_SCREEN_ID,
  DELIVERY_RESUBSCRIBE_PATH,
  DELIVERY_STATUS_CELL_COMPONENT,
  DELIVERY_TIME_CELL_COMPONENT,
  DELIVERY_TYPE_CELL_COMPONENT,
  DELIVERY_UNSUBSCRIBE_PATH,
  DeliveryErrors,
  DeliveryHandlers,
  DeliveryJobNames,
  DeliveryQueries,
  DeliveryStatus,
  type DeliveryStatusValue,
} from "./public-names.js";

// notify() priority → BullMQ job priority. Lower number = processed first; all
// > 0 so prioritised delivery jobs never mix with BullMQ's "0 = unprioritised
// FIFO" bucket. critical jobs jump ahead of normal/low in the worker queue.
export const deliveryPriorityRank: Record<NotifyPriority, number> = {
  critical: 1,
  normal: 2,
  low: 3,
};

export const DeliveryJobs = {
  render: qn(DELIVERY_FEATURE, QnTypes.job, DeliveryJobNames.render),
  send: qn(DELIVERY_FEATURE, QnTypes.job, DeliveryJobNames.send),
} as const;
