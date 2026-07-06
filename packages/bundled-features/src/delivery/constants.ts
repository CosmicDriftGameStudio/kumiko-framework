import type { NotifyPriority } from "@cosmicdrift/kumiko-framework/engine";
import { QnTypes, qn } from "@cosmicdrift/kumiko-framework/engine";
import { DELIVERY_FEATURE, DeliveryJobNames } from "./public-names";

export {
  DELIVERY_ATTEMPT_EVENT,
  DELIVERY_FEATURE,
  DELIVERY_LOG_SCREEN_ID,
  DeliveryErrors,
  DeliveryHandlers,
  DeliveryJobNames,
  DeliveryQueries,
  DeliveryStatus,
  type DeliveryStatusValue,
} from "./public-names";

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
