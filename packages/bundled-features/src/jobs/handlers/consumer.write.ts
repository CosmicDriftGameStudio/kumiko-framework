import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import {
  type ConsumerRecoveryState,
  ConsumerStatuses,
  ConsumerTransitionError,
  disableConsumer,
  enableConsumer,
  restartConsumer,
  skipPoisonEvent,
} from "@cosmicdrift/kumiko-framework/pipeline";
import * as z from "zod";
import type { CONSUMER_STATE_ACTIONS } from "../events.ts";
import {
  CONSUMER_STATE_CHANGED_EVENT_NAME,
  JOBS_AGGREGATE_TYPE,
  JobErrors,
} from "../web/constants.ts";

const consumerTargetSchema = z.object({ name: z.string().min(1), instanceId: z.string().min(1) });

const CONSUMER_STATE_REASON = "event consumer state is global dispatcher state, not tenant data";

function rejected(code: string, i18nKey: string) {
  return writeFailure(new UnprocessableError(code, { i18nKey }));
}

type ConsumerTransition = (
  db: Parameters<typeof restartConsumer>[0],
  name: string,
  instanceId: string,
) => Promise<ConsumerRecoveryState & { readonly skippedEventId?: bigint | null }>;

function defineConsumerWrite(
  name: string,
  action: (typeof CONSUMER_STATE_ACTIONS)[number],
  description: string,
  transition: ConsumerTransition,
) {
  return defineWriteHandler({
    name,
    description,
    schema: consumerTargetSchema,
    access: { roles: ["SystemAdmin"] },
    // Operator recovery for people only; skip drops an event for good.
    agent: { expose: false },
    handler: async (event, ctx) => {
      if (!ctx.systemDb) {
        throw new InternalError({
          message: `jobs:write:${name} requires ctx.systemDb (feature must declare r.systemScope())`,
        });
      }
      const db = ctx.systemDb.unsafeRaw(CONSUMER_STATE_REASON);
      let next: Awaited<ReturnType<ConsumerTransition>>;
      try {
        next = await transition(db, event.payload.name, event.payload.instanceId);
      } catch (e) {
        if (e instanceof ConsumerTransitionError) {
          return e.rejection === "unknown-consumer"
            ? rejected(JobErrors.consumerUnknown, "jobs.errors.consumerUnknown")
            : rejected(JobErrors.consumerWrongStatus, "jobs.errors.consumerWrongStatus");
        }
        ctx.obs.log?.error(
          `jobs:write:${name} failed: ${e instanceof Error ? e.message : String(e)}`,
          {
            consumer: event.payload.name,
            instanceId: event.payload.instanceId,
          },
        );
        return rejected(JobErrors.consumerTransitionFailed, "jobs.errors.consumerTransitionFailed");
      }
      if (next.skippedEventId === null) {
        return rejected(JobErrors.consumerNothingToSkip, "jobs.errors.consumerNothingToSkip");
      }
      const skippedEventId = next.skippedEventId?.toString() ?? null;
      // unsafeAppend: bundled-features cannot see an app's event map; the schema is checked via
      // r.defineEvent("consumer-state-changed", ...).
      await ctx.events.unsafeAppend({
        aggregateId: SYSTEM_TENANT_ID,
        aggregateType: JOBS_AGGREGATE_TYPE,
        type: CONSUMER_STATE_CHANGED_EVENT_NAME,
        payload: {
          action,
          name: next.name,
          instanceId: next.instanceId,
          skippedEventId,
          actor: event.user.id,
        },
      });
      return {
        isSuccess: true,
        data: { name: next.name, instanceId: next.instanceId, status: next.status, skippedEventId },
      };
    },
  });
}

export const consumerRestartWrite = defineConsumerWrite(
  "consumer-restart",
  "restarted",
  "Sets a dead event consumer back to idle so it retries the event that stopped it; use it after a transient failure is fixed.",
  restartConsumer,
);
export const consumerSkipWrite = defineConsumerWrite(
  "consumer-skip",
  "skipped",
  "Moves a stuck event consumer past the event that keeps failing; that event is never delivered to this consumer, so use it only for events that can never succeed.",
  (db, consumerName, instanceId) =>
    skipPoisonEvent(db, consumerName, instanceId, { requireStatus: ConsumerStatuses.dead }),
);
export const consumerDisableWrite = defineConsumerWrite(
  "consumer-disable",
  "disabled",
  "Pauses an event consumer; the dispatcher skips it until it is enabled again.",
  disableConsumer,
);
export const consumerEnableWrite = defineConsumerWrite(
  "consumer-enable",
  "enabled",
  "Resumes a paused event consumer from where it stopped.",
  enableConsumer,
);
