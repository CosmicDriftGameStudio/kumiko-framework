import { Hono } from "hono";
import type { PipelineContext, Registry } from "../engine/types";
import type { DispatcherOptions } from "../pipeline/dispatcher";
import { createDispatcher } from "../pipeline/dispatcher";
import { createLifecyclePipeline, type SystemHooks } from "../pipeline/lifecycle-pipeline";
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
  dispatcherOptions?: Omit<DispatcherOptions, "lifecycle">;
  systemHooks?: SystemHooks;
  sseBroker?: SseBroker;
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
  sseBroker: SseBroker;
};

export function buildServer(options: ServerOptions): KumikoServer {
  const jwt = createJwtHelper(options.jwtSecret, options.jwtIssuer);
  const sseBroker = options.sseBroker ?? createSseBroker();

  const lifecycle = createLifecyclePipeline(options.registry, options.systemHooks);

  const dispatcher = createDispatcher(options.registry, options.context, {
    ...options.dispatcherOptions,
    lifecycle,
  });

  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.use("/api/*", authMiddleware(jwt));
  app.route("/api", createApiRoutes(dispatcher));
  app.route("/api", createSseRoute(sseBroker));

  return { app, jwt, sseBroker };
}
