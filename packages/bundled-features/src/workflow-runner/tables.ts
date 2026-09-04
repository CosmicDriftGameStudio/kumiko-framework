import {
  defineUnmanagedTable,
  type EntityTableMeta,
  index,
  instant,
  integer,
  jsonb,
  table as pgTable,
  primaryKey,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";

// workflow_run_pending — one row per currently-suspended workflow step.
// Read-side of the resume loop (framework#2513 Phase 1): the wait /
// waitForEvent / retry steps already write their suspension onto the
// workflow-run event stream, but scanning kumiko_events for due runs
// doesn't scale (see samples/recipes/workflow-engine/postgres-resume-loop.ts,
// which does exactly that). This table is kept in sync by
// pending-projection.ts's MultiStreamProjection so Phase 2's resume job can
// do an indexed `wakeAt < now()` scan instead.
//
// **Unmanaged table** — same reasoning as delivery/tables.ts'
// deliveryAttemptsTable: rows are keyed by the workflow-run's own
// (runId, stepIndex), not by an ES-aggregate id of their own, and rows are
// deleted outright on resume/terminal rather than soft-state-transitioned —
// no audit trail needed for a purely operational pending-set.
//
// PK = (tenant_id, run_id, step_index): workflowRunAggregateId() is
// intentionally tenant-agnostic (uuidv5 over workflowName + idempotency
// key only, see aggregate-id.ts), so two tenants triggering the same
// workflow with the same idempotencyKey get the SAME run_id. Without
// tenant_id in the key, a same-stepIndex suspension from tenant B would
// upsert onto tenant A's row and silently steal it (framework#2513).
export const workflowRunPendingTable = pgTable(
  "workflow_run_pending",
  {
    runId: uuid("run_id").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    workflowName: text("workflow_name").notNull(),
    stepIndex: integer("step_index").notNull(),
    suspensionEventType: text("suspension_event_type").notNull(),
    // Unified `wakeAt ?? timeoutAt` from the suspension payload — one
    // column, one index, one predicate for the resume job regardless of
    // which step suspended.
    wakeAt: instant("wake_at").notNull(),
    retryAttempt: integer("retry_attempt"),
    // Q7 snapshot fingerprint — Phase 2 compares this against the current
    // workflow definition's fingerprint before resuming.
    definitionFingerprint: text("definition_fingerprint"),
    // Set only for waitForEvent suspensions; NULL for wait/retry.
    waitEventType: text("wait_event_type"),
    matchExpr: jsonb("match_expr"),
    // Written by the Phase 3 event-subscriber when the awaited event
    // arrives — always NULL in Phase 1/2.
    triggerEventType: text("trigger_event_type"),
    triggerPayload: jsonb("trigger_payload"),
  },
  (t) => [
    primaryKey({
      columns: [t.tenantId, t.runId, t.stepIndex],
      name: "workflow_run_pending_pkey",
    }),
    // Composite, not wake_at-alone: the resume job's due-scan
    // (feature.ts) always filters `tenant_id = $1 AND wake_at < now()`.
    index("workflow_run_pending_tenant_wake_at_idx").on(t.tenantId, t.wakeAt),
    index("workflow_run_pending_wait_event_type_idx").on(t.waitEventType),
  ],
);

export const workflowRunPendingTableMeta: EntityTableMeta = defineUnmanagedTable({
  tableName: "workflow_run_pending",
  columns: [
    { name: "run_id", pgType: "uuid", notNull: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "workflow_name", pgType: "text", notNull: true },
    { name: "step_index", pgType: "integer", notNull: true },
    { name: "suspension_event_type", pgType: "text", notNull: true },
    { name: "wake_at", pgType: "timestamptz", notNull: true },
    { name: "retry_attempt", pgType: "integer", notNull: false },
    { name: "definition_fingerprint", pgType: "text", notNull: false },
    { name: "wait_event_type", pgType: "text", notNull: false },
    { name: "match_expr", pgType: "jsonb", notNull: false },
    { name: "trigger_event_type", pgType: "text", notNull: false },
    { name: "trigger_payload", pgType: "jsonb", notNull: false },
  ],
  indexes: [
    { name: "workflow_run_pending_tenant_wake_at_idx", columns: ["tenant_id", "wake_at"] },
    { name: "workflow_run_pending_wait_event_type_idx", columns: ["wait_event_type"] },
  ],
  compositePrimaryKey: {
    name: "workflow_run_pending_pkey",
    columns: ["tenant_id", "run_id", "step_index"],
  },
});
