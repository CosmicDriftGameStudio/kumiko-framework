import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  InternalError,
  isKumikoError,
  type KumikoError,
  reraiseAsKumikoError,
  serializeError,
  ValidationError,
} from "../errors";
import type { Dispatcher } from "../pipeline/dispatcher";
import { stringifyJson } from "../utils/safe-json";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";
import { requestContext } from "./request-context";

export function createApiRoutes(dispatcher: Dispatcher) {
  const api = new Hono();

  api.post(Routes.write, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown; requestId?: string }>();

    try {
      const result = await dispatcher.write(body.type, body.payload, user, body.requestId);
      if (!result.isSuccess) {
        return writeErrorResponse(c, reraiseAsKumikoError(result.error));
      }
      return jsonResponse(c, result);
    } catch (e) {
      return writeErrorResponse(c, toKumiko(e));
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
      const result = await dispatcher.batch(body.commands, user, body.requestId);
      if (!result.isSuccess) {
        const err = reraiseAsKumikoError(result.error);
        const requestId = requestContext.get()?.requestId;
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
      return writeErrorResponse(c, toKumiko(e));
    }
  });

  api.post(Routes.query, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      const result = await dispatcher.query(body.type, body.payload, user);
      return jsonResponse(c, { data: result });
    } catch (e) {
      return queryErrorResponse(c, toKumiko(e));
    }
  });

  api.post(Routes.command, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      await dispatcher.command(body.type, body.payload, user);
      return c.json({ ok: true }, 202);
    } catch (e) {
      return queryErrorResponse(c, toKumiko(e));
    }
  });

  return api;
}

function jsonResponse(c: Context, body: unknown, status: ContentfulStatusCode = 200) {
  return c.body(stringifyJson(body), status, { "Content-Type": "application/json" });
}

function toKumiko(e: unknown): KumikoError {
  if (isKumikoError(e)) return e;
  if (e instanceof Error) return new InternalError({ cause: e });
  return new InternalError({ message: String(e) });
}

// For /write + /batch: keep the isSuccess flag so clients can flip on a single
// boolean (mirrors the success shape). The actual error body is the
// error-contract payload nested under .error.
function writeErrorResponse(c: Context, err: KumikoError, statusOverride?: number) {
  const requestId = requestContext.get()?.requestId;
  const { error } = serializeError(err, requestId);
  const status = (statusOverride ?? err.httpStatus) as ContentfulStatusCode; // @cast-boundary engine-payload
  return c.json({ isSuccess: false, error }, status);
}

// For /query + /command: no isSuccess on success (just { data } / {ok}), so we
// keep the same lean shape on failure — only the `error` key.
function queryErrorResponse(c: Context, err: KumikoError, statusOverride?: number) {
  const requestId = requestContext.get()?.requestId;
  const body = serializeError(err, requestId);
  const status = (statusOverride ?? err.httpStatus) as ContentfulStatusCode; // @cast-boundary engine-payload
  return c.json(body, status);
}
