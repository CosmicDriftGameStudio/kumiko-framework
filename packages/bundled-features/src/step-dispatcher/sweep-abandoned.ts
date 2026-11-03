import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  type Registry,
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_FAILED_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
  STEP_DISPATCHED_TYPE,
} from "@cosmicdrift/kumiko-framework/engine";
import { selectOpenStreamsStartedBefore } from "@cosmicdrift/kumiko-framework/event-store";
import { createMultiStreamApplyContext } from "@cosmicdrift/kumiko-framework/pipeline";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { STEP_DISPATCHER_FEATURE, SWEEP_ABANDONED_BATCH_SIZE } from "./constants.ts";
import { closeAbandonedDispatch } from "./deliver-dispatch-request.ts";

export type SweepAbandonedArgs = {
  readonly db: DbRunner;
  readonly registry: Registry;
  readonly startedBeforeIso: string;
  readonly onCloseFailure: (aggregateId: string, errorName: string) => void;
  readonly batchSize?: number;
};

// Pages by id until a short page: a stream that fails permanently stays open and would otherwise
// occupy the front of every run, starving the streams behind it.
export async function sweepAbandonedDispatches(args: SweepAbandonedArgs): Promise<void> {
  const batchSize = args.batchSize ?? SWEEP_ABANDONED_BATCH_SIZE;
  let afterId: string | undefined;
  for (;;) {
    const page = await selectOpenStreamsStartedBefore(args.db, {
      aggregateType: STEP_DISPATCH_AGGREGATE_TYPE,
      startedType: STEP_DISPATCH_REQUESTED_TYPE,
      closingTypes: [STEP_DISPATCHED_TYPE, STEP_DISPATCH_FAILED_TYPE],
      startedBeforeIso: args.startedBeforeIso,
      limit: batchSize,
      ...(afterId !== undefined && { afterId }),
    });
    for (const { tenantId, aggregateId } of page) {
      const applyContext = createMultiStreamApplyContext({
        registry: args.registry,
        db: args.db,
        tenantId,
        userId: SYSTEM_USER_ID,
        callerFeature: STEP_DISPATCHER_FEATURE,
      });
      try {
        await closeAbandonedDispatch(applyContext, aggregateId);
      } catch (err) {
        // One broken stream must not keep the others open; the next run retries it.
        args.onCloseFailure(aggregateId, err instanceof Error ? err.name : "unknown");
      }
    }
    const last = page.at(-1);
    // skip: a short page is the last one
    if (page.length < batchSize || last === undefined) return;
    afterId = last.id;
  }
}
