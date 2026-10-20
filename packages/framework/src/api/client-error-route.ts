import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as z from "zod";
import { createFallbackLogger, scrubLogText } from "../logging/index.ts";
import type { Meter } from "../observability/types/index.ts";
import { httpRouteRateLimit } from "../rate-limit/middleware.ts";
import type { RateLimitResolver } from "../rate-limit/resolver.ts";
import { Routes } from "./api-constants.ts";
import type { ClientIpResolver } from "./client-ip.ts";

const MAX_BODY_BYTES = 8 * 1024;
const REPORTS_PER_WINDOW = 10;
const WINDOW_SECONDS = 60;

const clientErrorReportSchema = z.strictObject({
  errorId: z.uuid(),
  kind: z.enum(["render", "unhandled"]),
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  screen: z.string().max(200).optional(),
  path: z.string().max(300).optional(),
  buildVersion: z.string().max(64).optional(),
});

// Query and fragment can carry tokens or personal data; only the route shape is useful for triage.
function stripQueryAndFragment(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? "";
}

export type ClientErrorRouteOptions = {
  readonly resolver: RateLimitResolver | undefined;
  readonly clientIpResolver: ClientIpResolver;
  readonly meter?: Meter;
  // Attaches tenantId/userId to the log line when the caller happens to hold a session.
  readonly identifySession: (c: Context) => Promise<void>;
};

export function createClientErrorRoute(options: ClientErrorRouteOptions): Hono {
  const app = new Hono();
  const logger = createFallbackLogger("client-errors");
  const routePath = `/api${Routes.clientErrors}`;

  if (options.resolver) {
    app.post(
      Routes.clientErrors,
      httpRouteRateLimit({
        resolver: options.resolver,
        rateLimit: { per: "ip", limit: REPORTS_PER_WINDOW, windowSeconds: WINDOW_SECONDS },
        routeKey: `POST ${routePath}`,
        clientIpResolver: options.clientIpResolver,
        ...(options.meter && { meter: options.meter }),
      }),
    );
  }
  app.post(
    Routes.clientErrors,
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: { code: "payload_too_large" } }, 413),
    }),
    async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json({ error: { code: "invalid_client_error_report" } }, 400);
      }
      const parsed = clientErrorReportSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json({ error: { code: "invalid_client_error_report" } }, 400);
      }
      await options.identifySession(c);
      const report = parsed.data;
      logger.warn("client error", {
        errorId: report.errorId,
        kind: report.kind,
        message: scrubLogText(report.message),
        ...(report.stack !== undefined && { stack: scrubLogText(report.stack) }),
        ...(report.screen !== undefined && { screen: scrubLogText(report.screen) }),
        ...(report.path !== undefined && {
          path: scrubLogText(stripQueryAndFragment(report.path)),
        }),
        ...(report.buildVersion !== undefined && { buildVersion: report.buildVersion }),
      });
      return c.body(null, 204);
    },
  );
  return app;
}
