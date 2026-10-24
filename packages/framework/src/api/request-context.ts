import { generateId } from "../utils/index.ts";
import { type RequestContextData, storage } from "./request-context-internals.ts";

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
export const requestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },

  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  generateId(): string {
    return generateId();
  },
};
// Public view: `run` would let a caller replace the request scope (entryHandler,
// writeOrigin), so only the read side is exposed through the /api barrel.
// Enter a scope that attributes every event written inside it. Keeps the
// surrounding request's ids so correlation survives, and mints fresh ones
// when there is no surrounding request (job-runner, event-dispatcher) —
// requestId/correlationId are mandatory, `get()` may be undefined.
// Clears entryHandler so the next dispatch inside fn becomes the new entry, letting
// the irreversible-operation gate see the invoked tool handler instead of the
// surrounding turn/approve handler. Reserved for dispatchToolCall, so it also marks
// the scope as an agent tool call; it always mints a scope, because an agent loop
// running outside any request must still carry that marker.
export function runAsAgentToolCallEntry<T>(fn: () => T): T {
  const current = requestContext.get();
  const requestId = current?.requestId ?? requestContext.generateId();
  const { entryHandler: _entryHandler, ...rest } = current ?? {};
  return requestContext.run(
    {
      ...rest,
      requestId,
      correlationId: current?.correlationId ?? requestId,
      agentToolCall: true,
    },
    fn,
  );
}

// An ungated origin never mints a scope: seeds and boot writes keep their missing context.
