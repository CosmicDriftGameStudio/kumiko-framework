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

// No entryHandler means the call didn't originate from a directly-dispatched
// handler (job, MSP/consumer apply, seed, afterCommit hook, HTTP route
// without a handler) — those are outside agent reach and stay ungated.
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
