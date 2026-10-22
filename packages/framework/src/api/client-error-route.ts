import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as z from "zod";
import { createFallbackLogger, scrubLogText } from "../logging/index.ts";
import type { Meter } from "../observability/types/index.ts";
import { httpRouteRateLimit, respondRateLimited } from "../rate-limit/middleware.ts";
import type { RateLimitDecision, RateLimitResolver } from "../rate-limit/resolver.ts";
import { Routes } from "./api-constants.ts";
import { type ClientIpResolver, clientIpSourceFromHonoContext } from "./client-ip.ts";

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
  buildVersion: z
    .string()
    .regex(/^[\w.+-]{1,64}$/)
    .optional(),
});

// Query and fragment can carry tokens or personal data; only the route shape is useful for triage.
function stripQueryAndFragment(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? "";
}

const MAX_TRACKED_IPS = 10_000;

// Without Redis there is no shared limiter; a per-process window still bounds log flooding.
function inMemoryIpRateLimit(
  clientIpResolver: ClientIpResolver,
  now: () => number,
): MiddlewareHandler {
  const windowMs = WINDOW_SECONDS * 1000;
  const windows = new Map<string, { count: number; startedAt: number }>();

  function evictExpired(nowMs: number): void {
    if (windows.size > MAX_TRACKED_IPS) {
      for (const [ip, window] of windows) {
        if (nowMs - window.startedAt >= windowMs) windows.delete(ip);
      }
    }
    // Map keeps insertion order and touched IPs are re-inserted, so the front is the least recently
    // seen; clear() would let an attacker rotating addresses reset every other IP's window.
    for (const ip of windows.keys()) {
      if (windows.size <= MAX_TRACKED_IPS) break;
      windows.delete(ip);
    }
  }

  return async (c, next) => {
    const ip = clientIpResolver.resolve(clientIpSourceFromHonoContext(c));
    const nowMs = now();
    evictExpired(nowMs);
    const existing = windows.get(ip);
    const window =
      existing && nowMs - existing.startedAt < windowMs ? existing : { count: 0, startedAt: nowMs };
    window.count += 1;
    windows.delete(ip);
    windows.set(ip, window);
    if (window.count > REPORTS_PER_WINDOW) {
      const resetAtMs = window.startedAt + windowMs;
      const decision: RateLimitDecision = {
        allowed: false,
        limit: REPORTS_PER_WINDOW,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000)),
        windowSeconds: WINDOW_SECONDS,
        resetAt: Temporal.Instant.fromEpochMilliseconds(resetAtMs),
      };
      return respondRateLimited(c, decision, `http:${ip}`);
    }
    await next();
  };
}

export type ClientErrorRouteOptions = {
  readonly resolver: RateLimitResolver | undefined;
  readonly clientIpResolver: ClientIpResolver;
  readonly meter?: Meter;
  readonly now?: () => number;
  // Attaches tenantId/userId to the log line when the caller happens to hold a session.
  readonly identifySession: (c: Context) => Promise<void>;
};

export function createClientErrorRoute(options: ClientErrorRouteOptions): Hono {
  const app = new Hono();
  const logger = createFallbackLogger("client-errors");
  const routePath = `/api${Routes.clientErrors}`;

  // Always on: the shared limiter fails open when Redis is down, this per-process window is the floor.
  app.post(
    Routes.clientErrors,
    inMemoryIpRateLimit(options.clientIpResolver, options.now ?? Date.now),
  );
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
