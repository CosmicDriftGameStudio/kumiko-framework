import { isPersonalDataGated, type WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import type { AgentRisk } from "@cosmicdrift/kumiko-types/handlers";
import { requestContext } from "./request-context.ts";

// Request-scoped propagation. Populated by the HTTP middleware and by the
// event-dispatcher when it runs an MSP-apply, so ctx.events.append downstream
// automatically stamps the right provenance on every event it writes.
//
//   requestId     — unique per HTTP request (or Job run). Log correlation.
//   correlationId — the end-to-end business operation id; propagates across
//                   service boundaries and MSP causation chains. Comes from
//                   the `x-correlation-id` header if set, otherwise mirrors
//                   requestId (clients that don't set the header pay no
//                   penalty — a single HTTP call == one correlation).
//   causationId   — the events.id that triggered THIS execution. Null for
//                   root HTTP commands; set when an MSP-apply is running
//                   (event-dispatcher wraps the handler call). Together
//                   with correlationId, forms a causal DAG across streams.
//   signal        — AbortSignal from the underlying HTTP request. Aborts
//                   when the client disconnects (mobile back-press, tab
//                   close). Query/stream handlers check signal.aborted at
//                   chunk or query boundaries; runBatch (write dispatch)
//                   strips it before executing so a disconnect can't abort
//                   a transaction mid-commit. Undefined for non-HTTP
//                   entry-points (jobs, MSP-applies) and inside write batches.
// Public view: `run` would let a caller replace the request scope (entryHandler,
// writeOrigin), so only the read side is exposed through the /api barrel.
export const readonlyRequestContext: Pick<typeof requestContext, "get"> = {
  get: requestContext.get,
};

// Enter a scope that attributes every event written inside it. Keeps the
// surrounding request's ids so correlation survives, and mints fresh ones
// when there is no surrounding request (job-runner, event-dispatcher) —
// requestId/correlationId are mandatory, `get()` may be undefined.
export function runWithOrigin<T>(
  origin: {
    readonly feature?: string;
    readonly handler?: string;
    readonly entryHandler?: { readonly qn: string; readonly risk: AgentRisk };
  },
  fn: () => T,
): T {
  const current = requestContext.get();
  const requestId = current?.requestId ?? requestContext.generateId();
  return requestContext.run(
    {
      ...current,
      requestId,
      correlationId: current?.correlationId ?? requestId,
      feature: origin.feature,
      handler: origin.handler,
      // The outermost dispatch wins — a nested ctx.dispatch.write/writeAs must not
      // overwrite the entry handler that the irreversible-operation gate reads.
      entryHandler: current?.entryHandler ?? origin.entryHandler,
      chargedRateLimitBuckets: current?.entryHandler
        ? current.chargedRateLimitBuckets
        : new Set<string>(),
    },
    fn,
  );
}

export function isAgentToolCallScope(): boolean {
  return requestContext.get()?.agentToolCall === true;
}

// An ungated origin never mints a scope: seeds and boot writes keep their missing context.
export function runWithWriteOrigin<T>(origin: WriteOrigin, fn: () => T): T {
  const current = requestContext.get();
  if (!isPersonalDataGated(origin)) {
    if (!current?.writeOrigin) return fn();
    const { writeOrigin: _writeOrigin, ...rest } = current;
    return requestContext.run(rest, fn);
  }
  const requestId = current?.requestId ?? requestContext.generateId();
  return requestContext.run(
    {
      ...current,
      requestId,
      correlationId: current?.correlationId ?? requestId,
      writeOrigin: origin,
    },
    fn,
  );
}
