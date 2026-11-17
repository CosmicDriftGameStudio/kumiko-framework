import type { JobRunnerRef } from "@cosmicdrift/kumiko-types/handlers";
import type { DbConnection } from "../db/connection.ts";
import type { Registry, SessionUser } from "../engine/types/index.ts";
import { type EventUpcasters, upcastStoredEvent } from "../event-store/upcaster.ts";
import { catchUpEventTypesOf } from "./catch-up-job-consumer.ts";
import type { EventConsumer } from "./event-dispatcher.ts";

// --- Job-Trigger Consumer (async, via event-dispatcher) ---
//
// r.job's `trigger.on` historically only fired via the synchronous
// write-handler dispatch path (dispatch-write.ts's afterCommitHooks calling
// jobRunner.handleEvent). Events appended any other way — an
// r.multiStreamProjection's ctx.events.unsafeAppend, or a raw
// event-store-executor write (e.g. `files`' fileRef.created) — never
// reached it, so a job could never trigger on an r.defineEvent-registered
// event.
//
// This consumer closes that gap the same way search/SSE do: read every
// committed event off the shared cursor and re-check job triggers. It is
// scoped EXACTLY to the gap — the write/query-handler-QN skip below is
// defense-in-depth: no stored event's `type` is a handler QN today (entity
// events are "entity.verb"; ctx.events.append enforces defineEvent-only
// ownership), but if that ever changes, this consumer must not re-fire a
// trigger the synchronous dispatch-write.ts path already handled.
//
// Delivery is at-least-once (cursor semantics) where the synchronous path
// is effectively once — job handlers reached via an r.defineEvent trigger
// must be idempotent.
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
      // skip: write/query-handler QN — already dispatched synchronously by
      // dispatch-write.ts's afterCommitHooks. Re-firing here would
      // double-enqueue every existing handler-triggered job.
      if (registry.getWriteHandler(storedEvent.type) || registry.getQueryHandler(storedEvent.type))
        return;
      // skip: no r.defineEvent registered under this type — nothing this
      // consumer is responsible for.
      if (!registry.getEvent(storedEvent.type)) return;
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
