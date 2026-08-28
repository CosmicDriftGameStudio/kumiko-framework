import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for workflow-run aggregate-id derivation. Frozen —
// changing it would re-key every existing run stream on replay.
const WORKFLOW_RUN_NAMESPACE = "1f8a6c3e-7d2b-4a91-9e3f-5c8b2a41d6f0";

/**
 * Deterministic aggregate-id for a workflow run keyed by (workflowName,
 * idempotencyKey). `aggregate_id` is a `uuid` column — a human-readable
 * `wf-<name>-<key>` string isn't a valid value. Same key always maps to the
 * same stream, which is what lets two *concurrent* triggers for that key
 * race on `expectedVersion` and have the loser fail the unique constraint
 * instead of silently double-running. It does NOT dedup sequential
 * re-triggers of the same key — those land as version 2, 3, ... on the same
 * stream and each starts its own run; that's out of scope for #2478.
 */
// @wrapper-known uuid-domain
export function workflowRunAggregateId(workflowName: string, key: string): string {
  return uuidv5(`${workflowName}|${key}`, WORKFLOW_RUN_NAMESPACE);
}
