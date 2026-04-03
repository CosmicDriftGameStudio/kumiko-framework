import { Hono } from "hono";
import type { Dispatcher } from "../pipeline/dispatcher";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";

export function createApiRoutes(dispatcher: Dispatcher) {
  const api = new Hono();

  api.post(Routes.write, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown; requestId?: string }>();
    const result = await dispatcher.write(body.type, body.payload, user, body.requestId);
    return c.json(result, result.isSuccess ? 200 : 400);
  });

  api.post(Routes.query, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      const result = await dispatcher.query(body.type, body.payload, user);
      return c.json({ data: result });
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown_error";
      const status = message.includes("not_found") ? 404 : message.includes("access") ? 403 : 400;
      return c.json({ error: message }, status);
    }
  });

  api.post(Routes.command, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ type: string; payload: unknown }>();

    try {
      await dispatcher.command(body.type, body.payload, user);
      return c.json({ ok: true }, 202);
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown_error";
      const status = message.includes("not_found") ? 404 : message.includes("access") ? 403 : 400;
      return c.json({ error: message }, status);
    }
  });

  return api;
}
