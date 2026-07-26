import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { SessionUser } from "../engine/types/handlers";
import {
  AccessDeniedError,
  type KumikoError,
  reraiseAsKumikoError,
  serializeError,
  toKumikoError,
  ValidationError,
} from "../errors";
import { createFallbackLogger } from "../logging";
import type { Dispatcher } from "../pipeline/dispatcher";
import { stringifyJson } from "../utils/safe-json";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";
import { patAllows } from "./pat-scope";
import { requestContext } from "./request-context";
import { SSE_HEARTBEAT_INTERVAL_MS } from "./sse-route";

// SSE frame event names for POST /api/stream (framework-owned; dispatcher-live
// has no dependency on this package and keeps its own copy in sse-stream.ts —
// a drift between the two fails the real-HTTP frame assertions in api.test.ts).
export const StreamFrame = {
  chunk: "chunk",
  ping: "ping",
  done: "done",
  error: "error",
} as const;

export type ApiRoutesOptions = {
  // Override the SSE heartbeat interval (ms). Default SSE_HEARTBEAT_INTERVAL_MS.
  // Deployment-tunable for proxies with different idle timeouts — also used
  // by tests with a short value to exercise the pre-pull race + ping path.
  readonly sseHeartbeatMs?: number;
};

export function createApiRoutes(dispatcher: Dispatcher, options: ApiRoutesOptions = {}) {
  const heartbeatMs = options.sseHeartbeatMs ?? SSE_HEARTBEAT_INTERVAL_MS;
  const api = new Hono();

  api.post(Routes.write, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown; requestId?: string }>();

    try {
      assertPatAllowed(user, body.type);
      const result = await dispatcher.write(body.type, body.payload, user, body.requestId);
      if (!result.isSuccess) {
        return writeErrorResponse(c, reraiseAsKumikoError(result.error), body.type);
      }
      return jsonResponse(c, result);
    } catch (e) {
      return writeErrorResponse(c, toKumiko(e), body.type);
    }
  });

  api.post(Routes.batch, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{
      commands: Array<{ type: string; payload: unknown }>;
      requestId?: string;
    }>();

    if (!Array.isArray(body.commands)) {
      // Client-shape violation → ValidationError (400, code=validation_error)
      // matches what a Zod-level schema failure would produce if /batch had
      // one. Client SDKs can key off the uniform validation contract.
      return writeErrorResponse(
        c,
        new ValidationError({
          fields: [
            {
              path: "commands",
              code: "invalid_type",
              i18nKey: "errors.validation.invalid_type",
              params: { expected: "array", received: typeof body.commands },
            },
          ],
        }),
      );
    }

    try {
      if (user.pat) {
        for (const cmd of body.commands) assertPatAllowed(user, cmd.type);
      }
      const result = await dispatcher.batch(body.commands, user, body.requestId);
      if (!result.isSuccess) {
        const err = reraiseAsKumikoError(result.error);
        const requestId = requestContext.get()?.requestId;
        const failedType =
          result.failedIndex != null ? body.commands[result.failedIndex]?.type : undefined;
        logServerFault(err, requestId, failedType);
        const { error } = serializeError(err, requestId);
        // Keep failedIndex + results alongside the error envelope so callers
        // can tell which command in the batch failed and inspect the partial
        // results from the successful commands before the rollback.
        return jsonResponse(
          c,
          {
            isSuccess: false,
            error,
            failedIndex: result.failedIndex,
            results: result.results,
          },
          err.httpStatus as ContentfulStatusCode, // @cast-boundary engine-payload
        );
      }
      return c.json(result);
    } catch (e) {
      // single "type" doesn't apply to a batch; command types keep the fault context.
      return writeErrorResponse(c, toKumiko(e), body.commands?.map((cmd) => cmd.type).join(","));
    }
  });

  api.post(Routes.query, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      assertPatAllowed(user, body.type);
      const result = await dispatcher.query(body.type, body.payload, user);
      return jsonResponse(c, { data: result });
    } catch (e) {
      return queryErrorResponse(c, toKumiko(e), body.type);
    }
  });

  api.post(Routes.command, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      assertPatAllowed(user, body.type);
      await dispatcher.command(body.type, body.payload, user);
      return c.json({ ok: true }, 202);
    } catch (e) {
      return queryErrorResponse(c, toKumiko(e), body.type);
    }
  });

  // Dispatcher-driven SSE, full auth/CSRF/rate-limit chain (unlike the
  // broker-based /sse route). Frame contract for clients: StreamFrame.chunk
  // (one per yielded value, JSON-encoded), .ping (heartbeat, empty data),
  // .done (terminal, empty data), .error (terminal, JSON error envelope —
  // only reachable once the stream is already open, i.e. failures from the
  // second chunk onward). The generator's first `.next()` — which runs the
  // dispatch gates (feature/rate-limit/access/validation) plus the handler's
  // first yield — is raced against a heartbeat timeout BEFORE streamSSE, so
  // a gate failure that settles in time maps to its real HTTP status via
  // queryErrorResponse instead of a flushed-200 error frame (framework#1517).
  api.post(Routes.stream, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();
    const requestId = requestContext.get()?.requestId;

    const generator = dispatcher.stream(body.type, body.payload, user);
    try {
      assertPatAllowed(user, body.type);
    } catch (e) {
      return queryErrorResponse(c, toKumiko(e), body.type);
    }

    // stream.onAbort() only exists once streamSSE opens the response below.
    // Hook the raw request signal directly so a client disconnect during the
    // pre-pull still reclaims the generator instead of leaking a Redis
    // subscription/DB cursor held open inside its still-unresolved first
    // `.next()` (framework#1528).
    const signal = c.req.raw.signal;
    const onPrePullAbort = () => void generator.return(undefined);
    signal.addEventListener("abort", onPrePullAbort);

    const firstPull = generator.next();
    let prePullTimer: ReturnType<typeof setTimeout> | undefined;
    const settledInTime = await Promise.race([
      firstPull.then(() => true).catch(() => true),
      new Promise<false>((resolve) => {
        prePullTimer = setTimeout(() => resolve(false), heartbeatMs);
      }),
    ]);
    clearTimeout(prePullTimer);
    signal.removeEventListener("abort", onPrePullAbort);

    if (settledInTime) {
      try {
        await firstPull;
      } catch (e) {
        return queryErrorResponse(c, toKumiko(e), body.type);
      }
    }

    if (signal.aborted) {
      // Fire-and-forget: settledInTime === false means firstPull is by
      // definition still pending — V8 queues a .return() request behind an
      // in-flight .next(), so awaiting here would block the response until
      // that pending pull resolves (which may be never for an idle stream).
      void generator.return(undefined).catch(() => {});
      return c.body(null, 499 as ContentfulStatusCode); // @cast-boundary non-standard client-closed-request status, Hono's union doesn't include it
    }

    return streamSSE(c, async (stream) => {
      stream.onAbort(() => {
        void generator.return(undefined);
      });

      try {
        await pumpStream(stream, generator, heartbeatMs, firstPull);
      } catch (e) {
        const err = toKumiko(e);
        logServerFault(err, requestId, body.type);
        const { error } = serializeError(err, requestId);
        await stream.writeSSE({ event: StreamFrame.error, data: stringifyJson(error) });
      }
    });
  });

  return api;
}

export type SseWriter = {
  readonly writeSSE: (message: { readonly event: string; readonly data: string }) => Promise<void>;
};

// Races each generator.next() against a heartbeat timer so an idle handler keeps the SSE connection alive.
export async function pumpStream(
  stream: SseWriter,
  generator: AsyncGenerator<unknown>,
  heartbeatMs: number,
  // Pending (or already-settled) first `.next()` — see the /api/stream route,
  // which races this against a heartbeat timeout before opening streamSSE.
  firstPull?: Promise<IteratorResult<unknown>>,
): Promise<void> {
  let pending = firstPull ?? generator.next();
  try {
    while (true) {
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
      const heartbeat = new Promise<"heartbeat">((resolve) => {
        heartbeatTimer = setTimeout(() => resolve("heartbeat"), heartbeatMs);
      });
      let outcome: Awaited<typeof pending> | "heartbeat";
      try {
        outcome = await Promise.race([pending, heartbeat]);
      } finally {
        clearTimeout(heartbeatTimer);
      }

      if (outcome === "heartbeat") {
        await stream.writeSSE({ event: StreamFrame.ping, data: "" });
        continue;
      }
      if (outcome.done) break;
      await stream.writeSSE({
        event: StreamFrame.chunk,
        data: stringifyJson(outcome.value ?? null),
      });
      pending = generator.next();
    }
    await stream.writeSSE({ event: StreamFrame.done, data: "" });
  } finally {
    // Fire-and-forget: if writeSSE threw mid-loop, `pending` (the last
    // generator.next()) may still be unresolved — V8 queues .return()
    // behind an in-flight .next(), so awaiting here would hang until that
    // pull settles (which may be never for a handler stuck on a dead
    // Redis/DB subscription the disconnect just orphaned).
    void generator.return(undefined).catch(() => {});
  }
}

function jsonResponse(c: Context, body: unknown, status: ContentfulStatusCode = 200) {
  return c.body(stringifyJson(body), status, { "Content-Type": "application/json" });
}

const toKumiko = toKumikoError;

// PAT scope enforcement at the API boundary. No-op for cookie/JWT users
// (user.pat undefined → unrestricted). For a PAT-authenticated request the
// dispatch type must match one of the token's granted-scope QN globs, else
// 403 — fail-closed, thrown so each route's existing catch shapes the body.
function assertPatAllowed(user: SessionUser, type: string): void {
  if (user.pat && !patAllows(user.pat.allowedQns, type)) {
    throw new AccessDeniedError({
      message: `personal access token scope does not permit ${type}`,
      details: { handler: type, scopes: user.pat.scopes },
    });
  }
}

// Unexpected server faults (5xx) carry their diagnostic stack only on the
// in-process error — serializeError strips cause/details from the wire body.
// Without this a wrapped throw (InternalError{cause}) returns a 500 with zero
// log lines, leaving ops nothing to debug (the bug this guards). 4xx are
// expected client outcomes and stay unlogged. `type` is the only handler
// discriminator — every request hits the same /api/{query,command} path.
function logServerFault(err: KumikoError, requestId: string | undefined, type?: string): void {
  if (err.httpStatus < 500) {
    // skip: 4xx are expected client outcomes (not-found, validation, denied) — logging them is noise
    return;
  }
  const cause = err.cause;
  createFallbackLogger("api").error("handler failed", {
    requestId,
    type,
    code: err.code,
    message: err.message,
    cause: cause instanceof Error ? cause.message : cause,
    stack: cause instanceof Error ? cause.stack : err.stack,
  });
}

// For /write + /batch: keep the isSuccess flag so clients can flip on a single
// boolean (mirrors the success shape). The actual error body is the
// error-contract payload nested under .error.
function writeErrorResponse(c: Context, err: KumikoError, type?: string) {
  const requestId = requestContext.get()?.requestId;
  logServerFault(err, requestId, type);
  const { error } = serializeError(err, requestId);
  return c.json({ isSuccess: false, error }, err.httpStatus as ContentfulStatusCode); // @cast-boundary engine-payload
}

// For /query + /command: no isSuccess on success (just { data } / {ok}), so we
// keep the same lean shape on failure — only the `error` key.
function queryErrorResponse(c: Context, err: KumikoError, type?: string) {
  const requestId = requestContext.get()?.requestId;
  logServerFault(err, requestId, type);
  const body = serializeError(err, requestId);
  return c.json(body, err.httpStatus as ContentfulStatusCode); // @cast-boundary engine-payload
}
