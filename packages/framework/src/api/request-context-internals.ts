import { AsyncLocalStorage } from "node:async_hooks";
import type { WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import type { AgentRisk } from "@cosmicdrift/kumiko-types/handlers";
import type { ErrorDocsConfig } from "../errors/docs-url.ts";

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
  // Attribution of the currently executing scope: the feature that
  // owns it and the qualified name of the handler / MSP-consumer / job
  // inside it. event-store.append() reads both and stamps them onto every
  // event written under this scope.
  readonly feature?: string;
  readonly handler?: string;
  // Resolved after authentication, so mutable: the store is created before the user is known.
  tenantId?: string;
  userId?: string;
  // performance.now() at request entry, so a failing request can report how
  // long it ran. Monotonic — a wall-clock step cannot make it negative.
  readonly startedAt?: number;
  // Only ever a gated origin. Read by job enqueue and event-store.append();
  // dispatch roots never narrow from it, only jobs inherit explicitly.
  readonly writeOrigin?: WriteOrigin;
  // The handler directly invoked by the dispatcher (not a nested ctx.dispatch.write/
  // writeAs target) — nested dispatches inherit it unchanged, so the
  // irreversible-operation gate always sees the outermost caller's risk.
  readonly entryHandler?: { readonly qn: string; readonly risk: AgentRisk };
  // Rate-limit bucket keys already charged by this entry dispatch. Nested
  // ctx.dispatch.query/queryAs/write calls share the entry's set, so one request costs
  // one token per bucket however many handlers it fans out to.
  readonly chargedRateLimitBuckets?: Set<string>;
  // Set by the agent-tools dispatch and inherited by every nested dispatch, so an
  // LLM-driven call can never pick up ctx.crossTenantReads, however deep it is nested.
  readonly agentToolCall?: true;
};

export const storage = new AsyncLocalStorage<RequestContextData>();

export function setRequestIdentity(identity: { tenantId: string; userId?: string }): void {
  const store = storage.getStore();
  // skip: outside a request scope there is no log context to enrich
  if (!store) return;
  store.tenantId = identity.tenantId;
  if (identity.userId !== undefined) store.userId = identity.userId;
}
