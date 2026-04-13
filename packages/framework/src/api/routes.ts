import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { FrameworkError } from "../engine/errors";
import type { Dispatcher } from "../pipeline/dispatcher";
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
        const reqId = requestContext.get()?.requestId;
        return c.json({ ...result, requestId: reqId }, 400);
      }
      return c.json(result);
    } catch (e) {
      const reqId = requestContext.get()?.requestId;
      if (e instanceof FrameworkError) {
        return c.json(
          { isSuccess: false, error: e.message, requestId: reqId },
          e.httpStatus as ContentfulStatusCode,
        );
      }
      const message = e instanceof Error ? e.message : "unknown_error";
      return c.json({ isSuccess: false, error: message, requestId: reqId }, 500);
    }
  });

  api.post(Routes.query, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      const result = await dispatcher.query(body.type, body.payload, user);
      return c.json({ data: result });
    } catch (e) {
      const reqId = requestContext.get()?.requestId;
      if (e instanceof FrameworkError) {
        return c.json(
          { error: e.message, code: e.code, requestId: reqId },
          e.httpStatus as ContentfulStatusCode,
        );
      }
      const message = e instanceof Error ? e.message : "unknown_error";
      return c.json({ error: message, requestId: reqId }, 500);
    }
  });

  api.post(Routes.command, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      await dispatcher.command(body.type, body.payload, user);
      return c.json({ ok: true }, 202);
    } catch (e) {
      const reqId = requestContext.get()?.requestId;
      if (e instanceof FrameworkError) {
        return c.json(
          { error: e.message, code: e.code, requestId: reqId },
          e.httpStatus as ContentfulStatusCode,
        );
      }
      const message = e instanceof Error ? e.message : "unknown_error";
      return c.json({ error: message, requestId: reqId }, 500);
    }
  });

  return api;
}
