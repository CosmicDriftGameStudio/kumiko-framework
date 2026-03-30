import { Hono } from "hono";
import type { PipelineContext, Registry } from "../engine/types";
import type { DispatcherOptions } from "../pipeline/dispatcher";
import { createDispatcher } from "../pipeline/dispatcher";
import { authMiddleware } from "./auth-middleware";
import { createJwtHelper, type JwtHelper } from "./jwt";
import { createApiRoutes } from "./routes";
import { createSseBroker, type SseBroker } from "./sse-broker";
import { createSseRoute } from "./sse-route";

export type ServerOptions = {
  registry: Registry;
  context: PipelineContext;
  jwtSecret: string;
  jwtIssuer?: string;
  dispatcherOptions?: DispatcherOptions;
  sseBroker?: SseBroker;
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
  sseBroker: SseBroker;
};

export function buildServer(options: ServerOptions): KumikoServer {
  const jwt = createJwtHelper(options.jwtSecret, options.jwtIssuer);
  const dispatcher = createDispatcher(options.registry, options.context, options.dispatcherOptions);
  const sseBroker = options.sseBroker ?? createSseBroker();

  const app = new Hono();

  // Health check (no auth)
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Auth middleware for all /api/* routes
  app.use("/api/*", authMiddleware(jwt));

  // API routes
  app.route("/api", createApiRoutes(dispatcher));

  // SSE route
  app.route("/api", createSseRoute(sseBroker));

  return { app, jwt, sseBroker };
}
