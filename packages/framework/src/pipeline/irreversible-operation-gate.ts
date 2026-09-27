import { requestContext } from "../api/request-context";
import type { EntityDefinition } from "../engine/types";
import { AccessDeniedError, FrameworkReasons } from "../errors";

// forget hard-purges regardless of softDelete; delete is only irreversible
// when the entity has no soft-delete recovery path.
export function isIrreversibleEntityVerb(
  verb: "delete" | "forget",
  entity: EntityDefinition,
): boolean {
  return verb === "forget" || !entity.softDelete;
}

// The gate reads the directly dispatched entry handler; a write dispatched inside a deferred
// context (afterCommit hook, job, consumer) gets its own entryHandler and is gated too. Direct
// executor/KMS calls without one stay ungated in exactly two cases: deleting derived data
// rebuildable from a reversible source (document-ingest-foundation's forget-extract-with-file-ref
// consumer, re-created on fileRef.restored), and pipelines started by a risk "high" handler or a
// cron scan (forget cleanup, retention, tenant destroy). A deferred context can't return
// irreversibleOperationRequiresHighRisk to the agent synchronously, so the gate sits at the primitives.
export function assertIrreversibleOperationAllowed(operation: string): void {
  const entryHandler = requestContext.get()?.entryHandler;
  // skip: no entry handler (see above) or the entry handler already resolves "high".
  if (!entryHandler || entryHandler.risk === "high") return;
  throw new AccessDeniedError({
    message:
      `Handler "${entryHandler.qn}" performs an irreversible ${operation} but resolves agent risk ` +
      `"${entryHandler.risk}" — declare agent: { risk: "high" } on "${entryHandler.qn}". The ` +
      "directly called handler must carry it; delegating via ctx.write/writeAs does not.",
    details: {
      reason: FrameworkReasons.irreversibleOperationRequiresHighRisk,
      handler: entryHandler.qn,
      operation,
      resolvedRisk: entryHandler.risk,
    },
  });
}
