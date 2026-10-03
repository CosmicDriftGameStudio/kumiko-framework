// Registered-event declarations for the `kumiko:system:workflow.*` run-stream
// events. The names stay the literal system types stored in kumiko_events;
// registering them makes projections (r.extendEntityProjection / r.projection
// with source `workflow-run`) valid apply-key targets and lists them in the
// registry's event catalog.
//
// Appends of these types keep bypassing schema validation (append-event-core):
// the schemas here document the payloads the writers append and tolerate the
// legacy shapes still stored in old streams.

import type { EventDef } from "@cosmicdrift/kumiko-types/handlers";
import * as z from "zod";
import { SYSTEM_EVENT_PII_STANCES } from "../../crypto/system-event-pii.js";
import {
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "./_step-dispatch-constants.js";

const triggerEventRefSchema = z.object({
  eventId: z.string(),
  aggregateId: z.string(),
  version: z.number().int(),
});

// Optional on every step event: runs started before the Q7 fingerprint existed
// have none.
const stepContext = {
  workflowName: z.string(),
  stepIndex: z.number().int(),
  triggerEventType: z.string(),
  definitionFingerprint: z.string().optional(),
};

const WORKFLOW_SYSTEM_EVENT_SCHEMAS: ReadonlyArray<readonly [string, z.ZodType]> = [
  [
    WORKFLOW_RUN_STARTED_TYPE,
    z.object({
      workflowName: z.string(),
      triggerEventType: z.string(),
      // Current streams reference the trigger event; streams written before
      // #3474 carry a copy of its payload instead.
      triggerEventRef: triggerEventRefSchema.optional(),
      triggerPayload: z.unknown().optional(),
      definitionFingerprint: z.string().optional(),
      idempotencyKey: z.string().optional(),
    }),
  ],
  [
    WORKFLOW_RUN_COMPLETED_TYPE,
    z.object({ workflowName: z.string(), stepIndex: z.number().int() }),
  ],
  [
    WORKFLOW_RUN_FAILED_TYPE,
    z.object({
      workflowName: z.string(),
      stepIndex: z.number().int(),
      error: z.string(),
      reason: z.string().optional(),
    }),
  ],
  [WORKFLOW_WAITING_TYPE, z.object({ ...stepContext, wakeAt: z.string() })],
  [
    WORKFLOW_WAITING_FOR_EVENT_TYPE,
    z.object({
      ...stepContext,
      eventType: z.string(),
      match: z.record(z.string(), z.unknown()).optional(),
      timeoutAt: z.string(),
    }),
  ],
  [
    WORKFLOW_RESUMED_TYPE,
    z.object({ stepIndex: z.number().int(), retryAttempt: z.number().int().optional() }),
  ],
  [
    WORKFLOW_RETRY_SCHEDULED_TYPE,
    z.object({
      ...stepContext,
      attempt: z.number().int(),
      maxAttempts: z.number().int(),
      wakeAt: z.string(),
      error: z.string(),
    }),
  ],
];

function buildWorkflowSystemEventDefs(): ReadonlyMap<string, EventDef> {
  const defs = new Map<string, EventDef>();
  for (const [name, schema] of WORKFLOW_SYSTEM_EVENT_SCHEMAS) {
    const piiFields = SYSTEM_EVENT_PII_STANCES.get(name);
    if (piiFields === undefined) {
      throw new Error(`Workflow system event "${name}" has no entry in SYSTEM_EVENT_PII_STANCES`);
    }
    defs.set(name, { name, schema, version: 1, piiFields });
  }
  return defs;
}

export const WORKFLOW_SYSTEM_EVENT_DEFS: ReadonlyMap<string, EventDef> =
  buildWorkflowSystemEventDefs();
