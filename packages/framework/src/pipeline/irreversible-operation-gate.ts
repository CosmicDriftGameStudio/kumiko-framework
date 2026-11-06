import { IRREVERSIBLE_WITHOUT_ENTRY_HANDLER_CASES } from "@cosmicdrift/kumiko-types/config";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { requestContext } from "../api/request-context.ts";
import type { RequestContextData } from "../api/request-context-internals.ts";

import { AccessDeniedError, FrameworkReasons } from "../errors/index.ts";
import type { FrameworkReason } from "../errors/reasons.ts";

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
// context (afterCommit hook, job, consumer) gets its own entryHandler and is gated too. A direct
// executor/KMS call inside a request scope without one passes only when the job or consumer
// declared irreversibleWithoutEntryHandler, whose closed union names the allowed cases. Without any
// request scope (boot seed, CLI, direct test call) nothing is checked. A deferred context can't
// return the reason to the agent synchronously, so the gate sits at the primitives.
function assertEntryHandlerHighRisk(args: {
  reason: FrameworkReason;
  operation: string;
  buildMessage: (entryHandler: EntryHandler) => string;
  details: Record<string, unknown>;
}): void {
  const scope = requestContext.get();
  // skip: no request scope, so no pipeline to hold to the gate.
  if (!scope) return;
  const { entryHandler } = scope;
  if (!entryHandler) {
    // skip: the job or consumer declared why it may run without an entry handler.
    if (scope.irreversibleWithoutEntryHandler) return;
    throw new AccessDeniedError({
      message: undeclaredPipelineMessage(scope.handler, args.operation),
      details: {
        reason: FrameworkReasons.irreversibleOperationWithoutEntryHandler,
        handler: scope.handler,
        gate: args.reason,
        ...args.details,
      },
    });
  }
  // skip: the entry handler already resolves "high".
  if (entryHandler.risk === "high") return;
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

function undeclaredPipelineMessage(pipeline: string | undefined, operation: string): string {
  const cases = IRREVERSIBLE_WITHOUT_ENTRY_HANDLER_CASES.map((name) => `"${name}"`).join(" | ");
  return (
    `${pipeline ? `"${pipeline}"` : "A request scope"} performs an irreversible ${operation} without ` +
    "a directly dispatched entry handler and without a declared exception. A job or " +
    `multi-stream projection that may do this declares irreversibleWithoutEntryHandler: ${cases}; ` +
    'anything else (route, afterCommit hook, agent tool call) dispatches a write handler with agent: { risk: "high" } instead.'
  );
}

// Stream handlers have no agent hint, so the "declare risk high" advice cannot apply to them.
function highRiskRemedy(entryHandler: EntryHandler): string {
  return entryHandler.qn.includes(":stream:")
    ? 'stream handlers cannot declare an agent risk and always resolve "mid" — dispatch a risk "high" write handler directly instead'
    : `declare agent: { risk: "high" } on "${entryHandler.qn}"`;
}

export function assertIrreversibleOperationAllowed(operation: string): void {
  assertEntryHandlerHighRisk({
    reason: FrameworkReasons.irreversibleOperationRequiresHighRisk,
    operation,
    buildMessage: (entryHandler) =>
      `Handler "${entryHandler.qn}" performs an irreversible ${operation} but resolves agent risk ` +
      `"${entryHandler.risk}" — ${highRiskRemedy(entryHandler)}. The ` +
      "directly called handler must carry it; delegating via ctx.dispatch.write/writeAs does not.",
    details: { operation },
  });
}

// Fields flagged readAsInstruction: true have their write payload presence checked here — the
// same reasoning as assertIrreversibleOperationAllowed, but the irreversible property belongs to
// the target field, not the verb. Presence in the payload (not a value comparison against the
// loaded row) is the deliberate fail-closed choice.
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
    operation: `${verb} of "${entityName}" field(s) ${fields.join(", ")} flagged readAsInstruction`,
    buildMessage: (entryHandler) =>
      `Handler "${entryHandler.qn}" ${verb}s "${entityName}" field(s) ${fields.join(", ")} ` +
      `flagged readAsInstruction: true but resolves agent risk "${entryHandler.risk}" — ` +
      `${highRiskRemedy(entryHandler)}. The directly called handler must carry ` +
      "it; delegating via ctx.dispatch.write/writeAs does not.",
    details: { entityName, verb, fields },
  });
}
