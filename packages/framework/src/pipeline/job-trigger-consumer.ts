import type { JobRunnerRef } from "@cosmicdrift/kumiko-types/handlers";
import type { DbConnection } from "../db/connection.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { type EventUpcasters, upcastStoredEvent } from "../event-store/upcaster.ts";
import { catchUpEventTypesOf } from "./catch-up-job-consumer.ts";
import type { EventConsumer } from "./event-dispatcher.ts";

// --- Job-Trigger Consumer (async, via event-dispatcher) ---
//
// The only path for r.job's `trigger.on`: it reads every committed event off
// the shared cursor and enqueues the jobs listening to the event type. An
// after-commit enqueue from the write path was lost when the process died
// between commit and enqueue; the cursor makes the event survive that.
//
// Delivery is at-least-once, deduplicated by a deterministic job id per job
// and event (eventTriggeredJobId), so a redelivery is a no-op while the job is
// retained. Job handlers must still be idempotent.
export const JOB_TRIGGER_CONSUMER_NAME = "system:consumer:job-trigger";

export function createJobTriggerEventConsumer(
  jobRunner: JobRunnerRef,
  registry: Registry,
  upcast: { readonly db: DbConnection; readonly upcasters: EventUpcasters },
): EventConsumer {
  const triggerTypes = new Set<string>();
  for (const [, jobDef] of registry.getAllJobs()) {
    if (!("on" in jobDef.trigger) || jobDef.trigger.catchUp) continue;
    for (const type of catchUpEventTypesOf(jobDef.trigger)) triggerTypes.add(type);
  }
  return {
    name: JOB_TRIGGER_CONSUMER_NAME,
    handler: async (storedEvent) => {
      // skip: no event-triggered job listens to this type — returning before the upcast keeps another event's broken upcaster from stalling this consumer.
      if (!triggerTypes.has(storedEvent.type)) return;
      // Stored events can predate the event's current schema; the job sees the same shape the write path would hand it.
      const event = await upcastStoredEvent(storedEvent, upcast.upcasters, {
        db: upcast.db,
        tenantId: storedEvent.tenantId,
      });

      const user: SessionUser = {
        id: event.metadata.userId,
        tenantId: event.tenantId,
        roles: [],
      };
      await jobRunner.handleEvent(event.type, event.payload, user, {
        id: event.id,
        aggregateId: event.aggregateId,
        headers: event.metadata.headers ?? {},
      });
    },
  };
}
