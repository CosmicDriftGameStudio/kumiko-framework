import { type RequestContextData, requestContext } from "../api/request-context";
import type { EntityDefinition } from "../engine/types";
import { AccessDeniedError, type FrameworkReason, FrameworkReasons } from "../errors";

type EntryHandler = NonNullable<RequestContextData["entryHandler"]>;

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
// cron scan (forget cleanup, retention, tenant destroy). A deferred context can't return the
// reason to the agent synchronously, so the gate sits at the primitives.
function assertEntryHandlerHighRisk(args: {
  reason: FrameworkReason;
  buildMessage: (entryHandler: EntryHandler) => string;
  details: Record<string, unknown>;
}): void {
  const entryHandler = requestContext.get()?.entryHandler;
  // skip: no entry handler (see above) or the entry handler already resolves "high".
  if (!entryHandler || entryHandler.risk === "high") return;
  throw new AccessDeniedError({
    message: args.buildMessage(entryHandler),
    details: {
      reason: args.reason,
      handler: entryHandler.qn,
      resolvedRisk: entryHandler.risk,
      ...args.details,
    },
  });
}

export function assertIrreversibleOperationAllowed(operation: string): void {
  assertEntryHandlerHighRisk({
    reason: FrameworkReasons.irreversibleOperationRequiresHighRisk,
    buildMessage: (entryHandler) =>
      `Handler "${entryHandler.qn}" performs an irreversible ${operation} but resolves agent risk ` +
      `"${entryHandler.risk}" — declare agent: { risk: "high" } on "${entryHandler.qn}". The ` +
      "directly called handler must carry it; delegating via ctx.write/writeAs does not.",
    details: { operation },
  });
}

// Fields flagged readAsInstruction: true have their write payload presence checked here — the
// same reasoning as assertIrreversibleOperationAllowed, but the irreversible property belongs to
// the target field, not the verb. Presence in the payload (not a value comparison against the
// loaded row) is the deliberate fail-closed choice — see kumiko-framework#3358.
export function assertInstructionFieldWriteAllowed(
  entityName: string,
  verb: "create" | "update",
  writtenFieldNames: readonly string[],
  instructionFieldNames: readonly string[],
): void {
  const fields = writtenFieldNames.filter((name) => instructionFieldNames.includes(name));
  // skip: the write touches no readAsInstruction field.
  if (fields.length === 0) return;
  assertEntryHandlerHighRisk({
    reason: FrameworkReasons.instructionFieldWriteRequiresHighRisk,
    buildMessage: (entryHandler) =>
      `Handler "${entryHandler.qn}" ${verb}s "${entityName}" field(s) ${fields.join(", ")} ` +
      `flagged readAsInstruction: true but resolves agent risk "${entryHandler.risk}" — declare ` +
      `agent: { risk: "high" } on "${entryHandler.qn}". The directly called handler must carry ` +
      "it; delegating via ctx.write/writeAs does not.",
    details: { entityName, verb, fields },
  });
}
