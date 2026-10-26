import type { JobRunnerRef } from "@cosmicdrift/kumiko-types/handlers";
import type { DbConnection } from "../db/connection.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { type EventUpcasters, upcastStoredEvent } from "../event-store/upcaster.ts";
import type { EventConsumer } from "./event-dispatcher.ts";

export const CATCH_UP_JOB_CONSUMER_PREFIX = "job:";

// One consumer per catchUp job: its own cursor starts at the beginning of the
// event store, so events older than the job are replayed too. The enqueue id is
// deterministic (job QN + event id), see catchUpJobId. Replayed events can be
// older than the event's current schema, so they are upcast before the job sees them.
export function createCatchUpJobEventConsumer(
  jobRunner: JobRunnerRef,
  jobName: string,
  featureName: string | undefined,
  upcast: { readonly db: DbConnection; readonly upcasters: EventUpcasters },
): EventConsumer {
  return {
    name: `${CATCH_UP_JOB_CONSUMER_PREFIX}${jobName}`,
    delivery: "shared",
    startFrom: "beginning",
    ...(featureName !== undefined && { featureName }),
    handler: async (storedEvent) => {
      const event = await upcastStoredEvent(storedEvent, upcast.upcasters, {
        db: upcast.db,
        tenantId: storedEvent.tenantId,
      });
      const user: SessionUser = {
        id: event.metadata.userId,
        tenantId: event.tenantId,
        roles: [],
      };
      await jobRunner.handleCatchUpEvent?.(jobName, event.type, event.payload, user, {
        id: event.id,
        headers: event.metadata.headers ?? {},
      });
    },
  };
}
