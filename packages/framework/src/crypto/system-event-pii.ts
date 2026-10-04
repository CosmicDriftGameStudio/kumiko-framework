// PII stance of every `kumiko:system:*` event. System events bypass the
// registry (append-event-core), so they never reach the defineEvent catalog;
// this static map is their catalog. encryptEventPayloadPii fails closed on a
// system type with no entry here, so a new system event cannot ship its
// payload as plaintext by omission.

import type { EventPiiStance } from "@cosmicdrift/kumiko-types/handlers";
import {
  STEP_DISPATCH_FAILED_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
  STEP_DISPATCHED_TYPE,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "../engine/steps/_step-dispatch-constants.js";

export const SYSTEM_EVENT_PREFIX = "kumiko:system:";

// Lives here (not in event-store/transfer.ts) so this module stays free of
// an event-store import cycle; transfer.ts re-exports it.
export const AGGREGATE_TRANSFERRED_EVENT_TYPE = `${SYSTEM_EVENT_PREFIX}aggregate.transferred`;

// Payload is version/commit/pod name/start time — no personal data.
export const APP_STARTED_EVENT_TYPE = `${SYSTEM_EVENT_PREFIX}app.started`;
export const APP_INSTANCE_STREAM_TYPE = "app-instance";

const SELF = { personal: "self" } as const;

// Workflow run-stream payloads carry references and step bookkeeping only,
// never a copy of a foreign event payload, so "none" leaves nothing to shred.
export const SYSTEM_EVENT_PII_STANCES: ReadonlyMap<string, EventPiiStance> = new Map<
  string,
  EventPiiStance
>([
  [
    STEP_DISPATCH_REQUESTED_TYPE,
    {
      to: SELF,
      subject: SELF,
      body: SELF,
      from: SELF,
      url: SELF,
      headersJson: SELF,
      bodyJson: SELF,
    },
  ],
  [STEP_DISPATCHED_TYPE, "none"],
  [STEP_DISPATCH_FAILED_TYPE, "none"],
  [AGGREGATE_TRANSFERRED_EVENT_TYPE, "none"],
  [APP_STARTED_EVENT_TYPE, "none"],
  [WORKFLOW_WAITING_TYPE, "none"],
  [WORKFLOW_WAITING_FOR_EVENT_TYPE, "none"],
  [WORKFLOW_RESUMED_TYPE, "none"],
  [WORKFLOW_RUN_STARTED_TYPE, "none"],
  [WORKFLOW_RUN_COMPLETED_TYPE, "none"],
  [WORKFLOW_RUN_FAILED_TYPE, "none"],
  [WORKFLOW_RETRY_SCHEDULED_TYPE, "none"],
]);
