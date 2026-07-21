import {
  type BatchResult,
  type Command,
  createStore,
  type Dispatcher,
  type DispatcherError,
  type DispatcherStatus,
  type PendingFile,
  type PendingWrite,
  type QueryOpts,
  type QueryResult,
  type StreamOpts,
  type WriteOpts,
  type WriteResult,
} from "@cosmicdrift/kumiko-headless";
import { CSRF_HEADER_NAME, readCsrfToken } from "./csrf";
import { buildAbortError, buildNetworkError, mapServerError } from "./error-mapping";
import { iterateSseChunks } from "./sse-stream";

// HTTP-only dispatcher. Maps Kumiko's client-side Dispatcher contract to
// `POST /api/{write,query,batch}`. No local store, no queue, no retry —
// a failed call surfaces immediately. This is the right fit for:
//   - web admin/cockpit apps (always-online context)
//   - mobile "managed" apps where offline means "locked"
//
// For local-first UIs (mobile-field apps, PWA offline mode) use
// @cosmicdrift/kumiko-dispatcher-savable (M7) — same contract, different semantics.
//
// Wiring — app entrypoint:
//   const dispatcher = createLiveDispatcher();  // defaults are fine for same-origin
//   <DispatcherProvider dispatcher={dispatcher}>...
//
// Split-deploy (API on a different origin):
//   const dispatcher = createLiveDispatcher({ baseUrl: "https://api.example.com" });
//   // Requires CORS + matching cookie SameSite=None; Secure.

export type LiveDispatcherOptions = {
  // Base URL for API calls. Default "" → relative paths (same-origin via
  // Vite-proxy in dev, reverse-proxy in prod). Set to a full origin only
  // for split-deploy with CORS.
  readonly baseUrl?: string;
  // Override fetch — used by tests to inject a spy/mock. Defaults to
  // globalThis.fetch; in environments without it (very old Node,
  // non-browser runtimes missing a polyfill) the dispatcher throws at
  // first call instead of construction (no reason to fail boot in an
  // SSR pre-pass where fetch may be wired in later).
  readonly fetch?: typeof fetch;
  // Source of the CSRF token. Defaults to `document.cookie`. Tests
  // inject a string; React-Native apps could inject a token fetched
  // from a /session endpoint when they don't have same-origin cookies.
  readonly readCsrf?: () => string | undefined;
};

// Paths — matched against the server routes (packages/framework/src/api/routes.ts).
// Kept as constants so refactors elsewhere (api-constants.ts bumped on the
// server) flag a mismatch here in a code review instead of at runtime.
const PATH_WRITE = "/api/write";
const PATH_QUERY = "/api/query";
const PATH_BATCH = "/api/batch";
const PATH_STREAM = "/api/stream";

export function createLiveDispatcher(options: LiveDispatcherOptions = {}): Dispatcher {
  const baseUrl = options.baseUrl ?? "";
  const readCsrf = options.readCsrf ?? (() => readCsrfToken());

  // Status state — transitions between "online" and "offline" driven
  // purely by call outcomes. "syncing" never fires here (live has
  // nothing to catch up on). Initial "online": optimism — we haven't
  // proven the server is unreachable, and a down-state on boot would
  // show an offline-toast before the user has even clicked anything.
  const statusStore = createStore<DispatcherStatus>("online");

  // A status-flip drives network-error → "offline" and any subsequent
  // success → "online". Typed server failures (400, 403, ...) don't flip
  // status — the network reached the server, the server answered, we're
  // online in every operational sense.
  function observeNetworkOutcome(ok: boolean): void {
    statusStore.setState(ok ? "online" : "offline");
  }

  type CallResult =
    | { readonly ok: true; readonly body: unknown; readonly status: number }
    | { readonly ok: false; readonly networkFailure: DispatcherError };

  async function callJson(
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<CallResult> {
    const f = options.fetch ?? globalThis.fetch;
    if (!f) {
      return {
        ok: false,
        networkFailure: buildNetworkError(
          "fetch is not available in this runtime — inject via LiveDispatcherOptions.fetch",
        ),
      };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const csrf = readCsrf();
    if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;
    // If no CSRF token, still send the request — public / pre-login
    // routes like /auth/login don't require CSRF, and POST /write/query/
    // batch against a logged-out client returns 401 via auth-middleware
    // which is a cleaner error than a csrf-mismatch.

    let response: Response;
    try {
      response = await f(`${baseUrl}${path}`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      // Abort surfaces as a DOMException with name="AbortError" in the
      // standard fetch contract. Handle it distinctly so the caller
      // doesn't see the user-cancellation as a network drop.
      if (isAbortError(e)) {
        return { ok: false, networkFailure: buildAbortError() };
      }
      observeNetworkOutcome(false);
      return { ok: false, networkFailure: buildNetworkError(e) };
    }

    observeNetworkOutcome(true);

    // JSON body parse. A server that returned a non-JSON body for any
    // reason (HTML error page from a reverse-proxy, empty body on a
    // weird 502) maps to network-error — structurally the same as a
    // fetch-throw from the UI's perspective.
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (e) {
      return {
        ok: false,
        networkFailure: buildNetworkError(
          `invalid JSON response (${response.status}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      };
    }
    return { ok: true, body: parsed, status: response.status };
  }

  return {
    async write<TData = unknown>(
      type: string,
      payload: unknown,
      opts?: WriteOpts,
    ): Promise<WriteResult<TData>> {
      const body: Record<string, unknown> = { type, payload };
      // Idempotency by default (#761): without a requestId the server-side
      // dedup never engages and a transport-level double-send duplicates
      // events. Callers with a logical-submit id (savable queue, form
      // controllers) pass their own and keep it across their retries.
      body["requestId"] = opts?.requestId ?? generateRequestId();
      const call = await callJson(PATH_WRITE, body, opts?.signal);
      return normalizeWriteResult<TData>(call);
    },

    async query<TData = unknown>(
      type: string,
      payload: unknown,
      opts?: QueryOpts,
    ): Promise<QueryResult<TData>> {
      const body = { type, payload };
      const call = await callJson(PATH_QUERY, body, opts?.signal);
      return normalizeQueryResponse<TData>(call);
    },

    async batch(commands: readonly Command[], opts?: WriteOpts): Promise<BatchResult> {
      const body: Record<string, unknown> = { commands };
      // One id for the whole batch — the server caches the BatchResult
      // under it, so a retried batch returns the cached outcome instead of
      // re-executing the commands (#761).
      body["requestId"] = opts?.requestId ?? generateRequestId();
      const call = await callJson(PATH_BATCH, body, opts?.signal);
      return normalizeBatchResponse(call);
    },

    async *stream<TChunk = unknown>(
      type: string,
      payload: unknown,
      opts?: StreamOpts,
    ): AsyncGenerator<TChunk, void, undefined> {
      const f = options.fetch ?? globalThis.fetch;
      if (!f) {
        throw buildNetworkError(
          "fetch is not available in this runtime — inject via LiveDispatcherOptions.fetch",
        );
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      };
      const csrf = readCsrf();
      if (csrf !== undefined) headers[CSRF_HEADER_NAME] = csrf;

      let response: Response;
      try {
        response = await f(`${baseUrl}${PATH_STREAM}`, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ type, payload }),
          signal: opts?.signal,
        });
      } catch (e) {
        if (isAbortError(e)) throw buildAbortError();
        observeNetworkOutcome(false);
        throw buildNetworkError(e);
      }

      observeNetworkOutcome(true);

      const contentType = response.headers.get("content-type") ?? "";
      // Pre-SSE gate failures (PAT deny, etc.) return a normal JSON error
      // envelope — map them like /api/query before trying to read SSE.
      if (!contentType.includes("text/event-stream")) {
        let parsed: unknown;
        try {
          parsed = await response.json();
        } catch (e) {
          throw buildNetworkError(
            `invalid stream response (${response.status}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
        const body = parsed as { error?: ServerErrorLike };
        if (body?.error) {
          throw mapServerError({
            ...body.error,
            httpStatus: body.error.httpStatus ?? response.status,
          });
        }
        throw buildNetworkError(`unexpected non-SSE stream response (${response.status})`);
      }

      if (!response.body) {
        throw buildNetworkError("stream response has no body");
      }

      try {
        yield* iterateSseChunks<TChunk>(response.body);
      } catch (e) {
        // Abort can surface on the initial fetch OR while reading the SSE
        // body — both must map to the same `aborted` envelope so hooks
        // (useStreamHandler) can ignore user-cancel without an error toast.
        if (isAbortError(e) || opts?.signal?.aborted) throw buildAbortError();
        throw e;
      }
    },

    statusStore,
    // Live dispatcher has no queue. Returning a constant empty array
    // keeps the contract uniform with savable; UI code that renders
    // pending-badges draws nothing instead of branching on dispatcher
    // type.
    pendingWrites: (): readonly PendingWrite[] => EMPTY_PENDING_WRITES,
    pendingFiles: (): readonly PendingFile[] => EMPTY_PENDING_FILES,
  };
}

const EMPTY_PENDING_WRITES: readonly PendingWrite[] = Object.freeze([]);
const EMPTY_PENDING_FILES: readonly PendingFile[] = Object.freeze([]);

// crypto.randomUUID where available (browser, Bun, Node); Math.random
// fallback for React-Native runtimes without the WebCrypto polyfill.
// Uniqueness only needs to hold per user within the server's dedup window —
// this is an idempotency key, not a security token.
function generateRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `req-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

type CallOutcome =
  | { readonly ok: true; readonly body: unknown; readonly status: number }
  | { readonly ok: false; readonly networkFailure: DispatcherError };

// Write / Batch share the same envelope: `{ isSuccess: true, data }` on
// success, `{ isSuccess: false, error: ServerErrorInfo, ... }` on failure.
// Query uses a different envelope (see normalizeQueryResponse).
function normalizeWriteResult<TData>(call: CallOutcome): WriteResult<TData> {
  if (!call.ok) return { isSuccess: false, error: call.networkFailure };
  const body = call.body as
    | { isSuccess: true; data: TData }
    | { isSuccess: false; error: Parameters<typeof mapServerError>[0] };
  if (body.isSuccess) return body;
  return { isSuccess: false, error: mapServerError(body.error) };
}

function normalizeBatchResponse(call: CallOutcome): BatchResult {
  if (!call.ok) {
    return { isSuccess: false, error: call.networkFailure, failedIndex: -1, results: [] };
  }
  const body = call.body as
    | BatchResult
    | {
        isSuccess: false;
        error: Parameters<typeof mapServerError>[0];
        failedIndex: number;
        results: readonly WriteResult[];
      };
  if (body.isSuccess) return body;
  return {
    isSuccess: false,
    error: mapServerError(body.error),
    failedIndex: body.failedIndex,
    results: body.results,
  };
}

// Query envelope: Kumiko's /api/query returns `{ data: ... }` on success
// (no isSuccess flag) and `{ error: { code, i18nKey, message, ... } }`
// on failure. Source of truth: packages/framework/src/api/routes.ts:85
// (the query route handler that emits `c.json({ data: result })`).
// The HTTP status carries the failure-status; the error body itself
// doesn't repeat it (serializeError drops httpStatus to keep the wire
// payload lean). We have to reinject httpStatus from the Response.status
// here.
function normalizeQueryResponse<TData>(call: CallOutcome): QueryResult<TData> {
  if (!call.ok) return { isSuccess: false, error: call.networkFailure };
  const body = call.body as { data?: unknown; error?: ServerErrorLike };
  if (body && "error" in body && body.error) {
    const errorWithStatus: Parameters<typeof mapServerError>[0] = {
      ...body.error,
      httpStatus: body.error.httpStatus ?? call.status,
    };
    return { isSuccess: false, error: mapServerError(errorWithStatus) };
  }
  return { isSuccess: true, data: body?.data as TData };
}

// Minimal shape check — server's serialized error has code + i18nKey +
// message at minimum; we fill httpStatus from the Response if missing.
type ServerErrorLike = {
  readonly code: string;
  readonly httpStatus?: number;
  readonly i18nKey: string;
  readonly message: string;
  readonly details?: unknown;
  readonly i18nParams?: Readonly<Record<string, unknown>>;
  readonly requestId?: string;
};

function isAbortError(e: unknown): boolean {
  return (
    !!e &&
    typeof e === "object" &&
    "name" in (e as Record<string, unknown>) && // @cast-boundary error-details
    (e as { name?: unknown }).name === "AbortError"
  );
}
