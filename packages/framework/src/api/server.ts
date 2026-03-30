import { Hono } from "hono";
import type { PipelineContext, Registry } from "../engine/types";
import { createDispatcher } from "../pipeline/dispatcher";
import { authMiddleware } from "./auth-middleware";
import { createJwtHelper, type JwtHelper } from "./jwt";
import { createApiRoutes } from "./routes";

export type ServerOptions = {
  registry: Registry;
  context: PipelineContext;
  jwtSecret: string;
  jwtIssuer?: string;
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
};

export function buildServer(options: ServerOptions): KumikoServer {
  const jwt = createJwtHelper(options.jwtSecret, options.jwtIssuer);
  const dispatcher = createDispatcher(options.registry, options.context);

  const app = new Hono();

  // Health check (no auth)
  app.get("/health", (c) => c.json({ status: "ok" }));

  // API routes (auth required)
  const apiRoutes = createApiRoutes(dispatcher);
  app.use("/api/*", authMiddleware(jwt));
  app.route("/api", apiRoutes);

  return { app, jwt };
}
