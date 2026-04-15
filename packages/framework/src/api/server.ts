import { Hono } from "hono";
import type Redis from "ioredis";
import type { DbConnection } from "../db/connection";
import type { AppContext, Registry } from "../engine/types";
import type { FileRoutesOptions } from "../files/file-routes";
import { createFileRoutes } from "../files/file-routes";
import type { DispatcherOptions } from "../pipeline/dispatcher";
import { createDispatcher } from "../pipeline/dispatcher";
import type { EventBroker } from "../pipeline/event-broker";
import type { EventDedup } from "../pipeline/event-dedup";
import { createLifecycleHooks, type SystemHooks } from "../pipeline/lifecycle-pipeline";
import type { DeadLetterEvent, OutboxPoller } from "../pipeline/outbox-poller";
import { createOutboxPoller } from "../pipeline/outbox-poller";
import { PUBLIC_API_PATHS, Routes } from "./api-constants";
import { authMiddleware } from "./auth-middleware";
import { type AuthRoutesConfig, createAuthRoutes } from "./auth-routes";
import { createJwtHelper, type JwtHelper } from "./jwt";
import { requestIdMiddleware } from "./request-id-middleware";
import { createApiRoutes } from "./routes";
import { createSseBroker, type SseBroker } from "./sse-broker";
import { createSseRoute } from "./sse-route";

export type ServerOptions = {
  registry: Registry;
  context: AppContext;
  jwtSecret: string;
  jwtIssuer?: string;
  dispatcherOptions?: Omit<DispatcherOptions, "lifecycle" | "outbox">;
  systemHooks?: SystemHooks;
  eventDedup?: EventDedup;
  sseBroker?: SseBroker;
  auth?: AuthRoutesConfig;
  files?: Omit<FileRoutesOptions, "db"> & { db?: FileRoutesOptions["db"] };
  // Transactional outbox — when set, ctx.emit writes to event_outbox in the
  // current transaction and the in-process poller publishes rows after commit.
  // Requires a DbConnection in context.db. The subscriberRedis must be a
  // separate ioredis instance (a subscribed client can't issue other commands).
  outbox?: {
    redis: Redis;
    subscriberRedis: Redis;
    eventBroker: EventBroker;
    batchSize?: number;
    pollIntervalMs?: number;
    maxAttempts?: number;
    // Fires when an outbox row exhausts retries. Hook a metric / pager here.
    onDeadLetter?: (event: DeadLetterEvent) => void | Promise<void>;
  };
};

export type KumikoServer = {
  app: Hono;
  jwt: JwtHelper;
  sseBroker: SseBroker;
  // Present only when options.outbox was set. Callers that use buildServer
  // in production must call `outboxPoller.start()` during boot and
  // `outboxPoller.stop()` during shutdown.
  outboxPoller?: OutboxPoller;
};

export function buildServer(options: ServerOptions): KumikoServer {
  const jwt = createJwtHelper(options.jwtSecret, options.jwtIssuer);
  const sseBroker = options.sseBroker ?? createSseBroker();

  const lifecycle = createLifecycleHooks(
    options.registry,
    options.systemHooks,
    options.eventDedup ? { eventDedup: options.eventDedup } : undefined,
  );

  const dispatcher = createDispatcher(options.registry, options.context, {
    ...options.dispatcherOptions,
    lifecycle,
    ...(options.outbox ? { outbox: { redis: options.outbox.redis } } : {}),
  });

  // Outbox poller — created but NOT auto-started. The caller decides when
  // to start/stop (typically in an app-level boot + shutdown sequence).
  let outboxPoller: OutboxPoller | undefined;
  if (options.outbox) {
    const dbConn = options.context.db as DbConnection | undefined;
    if (!dbConn) {
      throw new Error("buildServer: options.outbox requires context.db to be a DbConnection");
    }
    outboxPoller = createOutboxPoller({
      db: dbConn,
      subscriberRedis: options.outbox.subscriberRedis,
      eventBroker: options.outbox.eventBroker,
      ...(options.outbox.batchSize !== undefined ? { batchSize: options.outbox.batchSize } : {}),
      ...(options.outbox.pollIntervalMs !== undefined
        ? { pollIntervalMs: options.outbox.pollIntervalMs }
        : {}),
      ...(options.outbox.maxAttempts !== undefined
        ? { maxAttempts: options.outbox.maxAttempts }
        : {}),
      ...(options.outbox.onDeadLetter !== undefined
        ? { onDeadLetter: options.outbox.onDeadLetter }
        : {}),
      ...(options.context.log !== undefined ? { log: options.context.log } : {}),
    });
  }

  const app = new Hono();

  app.get(Routes.health, (c) => c.json({ status: "ok" }));
  app.use("/api/*", requestIdMiddleware());

  // Auth middleware skips public paths (login, health) — those routes need
  // to be callable without a valid JWT. Every other /api/* request requires
  // a token.
  const jwtGuard = authMiddleware(jwt);
  app.use("/api/*", async (c, next) => {
    if (PUBLIC_API_PATHS.has(c.req.path)) return next();
    return jwtGuard(c, next);
  });

  // Public auth routes (login) need to be registered BEFORE the generic
  // api routes so Hono matches them first.
  if (options.auth) {
    app.route("/api", createAuthRoutes(dispatcher, jwt, options.auth));
  }
  app.route("/api", createApiRoutes(dispatcher));
  app.route("/api", createSseRoute(sseBroker));

  if (options.files) {
    const fileDb = options.files.db ?? (options.context.db as FileRoutesOptions["db"]);
    if (!fileDb) throw new Error("files option requires db in context or files.db");
    app.route(
      "/api",
      createFileRoutes({
        ...options.files,
        db: fileDb,
        registry: options.registry,
      }),
    );
  }

  return { app, jwt, sseBroker, ...(outboxPoller ? { outboxPoller } : {}) };
}
