import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
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
import { JobErrors } from "../web/constants.ts";

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

function defineConsumerWrite(name: string, description: string, transition: ConsumerTransition) {
  return defineWriteHandler({
    name,
    description,
    schema: consumerTargetSchema,
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      if (!ctx.systemDb) {
        throw new InternalError({
          message: `jobs:write:${name} requires ctx.systemDb (feature must declare r.systemScope())`,
        });
      }
      const db = ctx.systemDb.unsafeRaw(CONSUMER_STATE_REASON);
      try {
        const next = await transition(db, event.payload.name, event.payload.instanceId);
        if (next.skippedEventId === null) {
          return rejected(JobErrors.consumerNothingToSkip, "jobs.errors.consumerNothingToSkip");
        }
        return {
          isSuccess: true,
          data: {
            name: next.name,
            instanceId: next.instanceId,
            status: next.status,
            skippedEventId: next.skippedEventId?.toString() ?? null,
          },
        };
      } catch (e) {
        if (e instanceof ConsumerTransitionError) {
          return e.rejection === "unknown-consumer"
            ? rejected(JobErrors.consumerUnknown, "jobs.errors.consumerUnknown")
            : rejected(JobErrors.consumerWrongStatus, "jobs.errors.consumerWrongStatus");
        }
        ctx.log?.error(`jobs:write:${name} failed: ${e instanceof Error ? e.message : String(e)}`, {
          consumer: event.payload.name,
          instanceId: event.payload.instanceId,
        });
        return rejected(JobErrors.consumerTransitionFailed, "jobs.errors.consumerTransitionFailed");
      }
    },
  });
}

export const consumerRestartWrite = defineConsumerWrite(
  "consumer-restart",
  "Sets a dead event consumer back to idle so it retries the event that stopped it; use it after a transient failure is fixed.",
  restartConsumer,
);
export const consumerSkipWrite = defineConsumerWrite(
  "consumer-skip",
  "Moves a stuck event consumer past the event that keeps failing; that event is never delivered to this consumer, so use it only for events that can never succeed.",
  (db, consumerName, instanceId) =>
    skipPoisonEvent(db, consumerName, instanceId, { requireStatus: ConsumerStatuses.dead }),
);
export const consumerDisableWrite = defineConsumerWrite(
  "consumer-disable",
  "Pauses an event consumer; the dispatcher skips it until it is enabled again.",
  disableConsumer,
);
export const consumerEnableWrite = defineConsumerWrite(
  "consumer-enable",
  "Resumes a paused event consumer from where it stopped.",
  enableConsumer,
);
