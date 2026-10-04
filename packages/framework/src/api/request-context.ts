import { AsyncLocalStorage } from "node:async_hooks";
import { isPersonalDataGated, type WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import type { AgentRisk } from "@cosmicdrift/kumiko-types/handlers";
import type { ErrorDocsConfig } from "../errors/docs-url.js";
import { generateId } from "../utils/index.js";

// Request-scoped propagation. Populated by the HTTP middleware and by the
// event-dispatcher when it runs an MSP-apply, so ctx.appendEvent downstream
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
export type RequestContextData = {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly signal?: AbortSignal;
  // App-level error docs mapping, read when an error response is serialized.
  readonly errorDocs?: ErrorDocsConfig;
  // Client IP for per-IP rate limiting (L1, L2, L3 with per: "ip*").
  // Populated by requestIdMiddleware via the shared trustedProxyHops-aware
  // resolver (see api/client-ip.ts) — never skipped
  // for an HTTP request, falls back to "unknown" rather than leaving this
  // undefined. Undefined only for non-HTTP entry points (jobs, MSP).
  readonly ip?: string;
  // Raw User-Agent header — audit trails (download tokens, GDPR export
  // access) want it alongside `ip`. Undefined for non-HTTP entry points.
  readonly userAgent?: string;
  // Client-declared active UI locale (BCP-47), resolved once from
  // X-Locale / Accept-Language by requestIdMiddleware — see
  // request-locale.ts. Undefined when neither header carried a valid tag;
  // callers fall back further (dispatch-shared.ts's ctx.locale chain).
  readonly locale?: string;
  // Attribution of the currently executing scope (#3043): the feature that
  // owns it and the qualified name of the handler / MSP-consumer / job
  // inside it. event-store.append() reads both and stamps them onto every
  // event written under this scope.
  readonly feature?: string;
  readonly handler?: string;
  // performance.now() at request entry, so a failing request can report how
  // long it ran. Monotonic — a wall-clock step cannot make it negative.
  readonly startedAt?: number;
  // Only ever a gated origin. Read by job enqueue and event-store.append();
  // dispatch roots never narrow from it, only jobs inherit explicitly.
  readonly writeOrigin?: WriteOrigin;
  // The handler directly invoked by the dispatcher (not a nested ctx.write/
  // writeAs target) — nested dispatches inherit it unchanged, so the
  // irreversible-operation gate always sees the outermost caller's risk.
  readonly entryHandler?: { readonly qn: string; readonly risk: AgentRisk };
  // Rate-limit bucket keys already charged by this entry dispatch. Nested
  // ctx.query/queryAs/write calls share the entry's set, so one request costs
  // one token per bucket however many handlers it fans out to.
  readonly chargedRateLimitBuckets?: Set<string>;
};

const storage = new AsyncLocalStorage<RequestContextData>();

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
      // The outermost dispatch wins — a nested ctx.write/writeAs must not
      // overwrite the entry handler that the irreversible-operation gate reads.
      entryHandler: current?.entryHandler ?? origin.entryHandler,
      chargedRateLimitBuckets: current?.entryHandler
        ? current.chargedRateLimitBuckets
        : new Set<string>(),
    },
    fn,
  );
}

// Clears entryHandler so the next dispatch inside fn becomes the new entry —
// used by dispatchToolCall so the invoked tool handler, not the surrounding
// turn/approve handler, is what the irreversible-operation gate sees.
export function runAsDirectCallEntry<T>(fn: () => T): T {
  const current = requestContext.get();
  if (!current) return fn();
  const { entryHandler: _entryHandler, ...rest } = current;
  return requestContext.run(rest, fn);
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
