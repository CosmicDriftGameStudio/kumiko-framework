import { Hono } from "hono";
import type { AppContext, Registry } from "../engine/types";
import type { FileRoutesOptions } from "../files/file-routes";
import { createFileRoutes } from "../files/file-routes";
import type { DispatcherOptions } from "../pipeline/dispatcher";
import { createDispatcher } from "../pipeline/dispatcher";
import { createLifecycleHooks, type SystemHooks } from "../pipeline/lifecycle-pipeline";
import { Routes } from "./api-constants";
import { authMiddleware } from "./auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "./auth-routes";
import { createJwtHelper, type JwtHelper } from "./jwt";
import { createApiRoutes } from "./routes";
import { createSseBroker, type SseBroker } from "./sse-broker";
import { createSseRoute } from "./sse-route";

export type ServerOptions = {
  registry: Registry;
  context: AppContext;
  jwtSecret: string;
  jwtIssuer?: string;
  dispatcherOptions?: Omit<DispatcherOptions, "lifecycle">;
  systemHooks?: SystemHooks;
  sseBroker?: SseBroker;
  auth?: AuthRoutesConfig;
  files?: Omit<FileRoutesOptions, "db"> & { db?: FileRoutesOptions["db"] };
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
  sseBroker: SseBroker;
};

export function buildServer(options: ServerOptions): KumikoServer {
  const jwt = createJwtHelper(options.jwtSecret, options.jwtIssuer);
  const sseBroker = options.sseBroker ?? createSseBroker();

  const lifecycle = createLifecycleHooks(options.registry, options.systemHooks);

  const dispatcher = createDispatcher(options.registry, options.context, {
    ...options.dispatcherOptions,
    lifecycle,
  });

  const app = new Hono();

  app.get(Routes.health, (c) => c.json({ status: "ok" }));
  app.use("/api/*", authMiddleware(jwt));
  app.route("/api", createApiRoutes(dispatcher));
  if (options.auth) {
    app.route("/api", createAuthRoutes(dispatcher, jwt, options.auth));
  }
  app.route("/api", createSseRoute(sseBroker));

  if (options.files) {
    const fileDb = options.files.db ?? (options.context["db"] as FileRoutesOptions["db"]);
    app.route(
      "/api",
      createFileRoutes({
        ...options.files,
        db: fileDb,
        registry: options.registry,
      }),
    );
  }

  return { app, jwt, sseBroker };
}
