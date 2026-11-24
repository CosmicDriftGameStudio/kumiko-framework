import { type FeatureRegistrar, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { HttpRouteHandler } from "@cosmicdrift/kumiko-types/http-route";
import {
  createLastActivityProbeQuery,
  LAST_ACTIVITY_PROBE_QUERY,
} from "./last-activity-probe.query.ts";
import { createUsageProbeQuery, USAGE_PROBE_QUERY } from "./usage-probe.query.ts";

// The route is reachable anonymously, so a short secret would be guessable within the rate limit.
const MIN_PROBE_SECRET_LENGTH = 32;

export const LAST_ACTIVITY_PROBE_SECRET_ENV = "SESSIONS_LAST_ACTIVITY_PROBE_SECRET";

// Env is the fallback for apps that mount sessions without options; the value is never echoed.
// The feature definition also runs in client bundles, where `process` may not exist.
export function readProbeSecretFromEnv(
  env: Readonly<Record<string, string | undefined>> | undefined = typeof process === "undefined"
    ? undefined
    : process.env,
): string | undefined {
  const secret = env?.[LAST_ACTIVITY_PROBE_SECRET_ENV];
  if (secret === undefined) return undefined;
  if (secret.length < MIN_PROBE_SECRET_LENGTH) {
    throw new Error(
      `sessions: ${LAST_ACTIVITY_PROBE_SECRET_ENV} must be at least ${MIN_PROBE_SECRET_LENGTH} characters`,
    );
  }
  return secret;
}

// Wrong secret and any handler failure look the same to the caller: 401.
async function answerBearerProbe(
  c: Parameters<HttpRouteHandler>[0],
  systemQuery: Parameters<HttpRouteHandler>[1]["systemQuery"],
  queryName: string,
): Promise<Response> {
  const bearerToken = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  if (bearerToken === undefined) return c.body(null, 401);
  try {
    return c.json(await systemQuery(queryName, { bearerToken }, SYSTEM_TENANT_ID));
  } catch {
    return c.body(null, 401);
  }
}

export function registerLastActivityProbe(r: FeatureRegistrar, secret: string): void {
  if (secret.length < MIN_PROBE_SECRET_LENGTH) {
    throw new Error(
      `sessions: lastActivityProbeSecret must be at least ${MIN_PROBE_SECRET_LENGTH} characters`,
    );
  }
  r.queryHandler(createLastActivityProbeQuery(secret));
  r.httpRoute({
    method: "GET",
    // A string literal so feature-ast can read the route; r.httpRoute paths stay outside /api/*.
    path: "/sessions/last-activity",
    anonymous: true,
    rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
    handler: (c, { systemQuery }) => answerBearerProbe(c, systemQuery, LAST_ACTIVITY_PROBE_QUERY),
  });
  r.queryHandler(createUsageProbeQuery(secret));
  r.httpRoute({
    method: "GET",
    path: "/sessions/usage",
    anonymous: true,
    rateLimit: { per: "ip+handler", limit: 30, windowSeconds: 60 },
    handler: (c, { systemQuery }) => answerBearerProbe(c, systemQuery, USAGE_PROBE_QUERY),
  });
}
