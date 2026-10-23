import type { KumikoServeEnv } from "@cosmicdrift/kumiko-framework/api";
import { assertNoActiveRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/db";
import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import { flushEscapeHatchAudits } from "@cosmicdrift/kumiko-framework/pipeline";
import { installShutdownSignals } from "./boot-options/process-signals.ts";
import { buildBunServeOptions, resolveDerivedMaxRequestBodySize } from "./bun-serve-options.ts";
import { installFatalErrorHandlers } from "./fatal-error-handlers.ts";
import { uninstallProcessLogger } from "./process-logger.ts";
import type { ProdAppHandle, RunProdAppOptions } from "./run-prod-app.ts";
import type { ProdBootConfig, ProdComposedFeatures } from "./run-prod-app-config.ts";
import type { ProdConnections } from "./run-prod-app-connections.ts";
import type { ProdEntrypoint } from "./run-prod-app-entrypoint.ts";
import {
  buildStaticFallback,
  resolveCspScriptHashes,
  resolveHostDispatchScriptHashes,
} from "./run-prod-app-static-files.ts";
import { withSecurityHeaders } from "./security-headers.ts";
import { stripNoRouteMatchHeader } from "./try-hono-first.ts";

const SERVER_GRACEFUL_STOP_MS = 10_000;

// stop() without force waits for open connections (SSE never ends on its own); force-close after the grace period.
async function stopServerGracefully(server: { stop(closeActiveConnections?: boolean): unknown }) {
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const graceElapsed = new Promise<void>((resolve) => {
    graceTimer = setTimeout(resolve, SERVER_GRACEFUL_STOP_MS);
  });
  try {
    await Promise.race([server.stop(), graceElapsed]);
  } finally {
    clearTimeout(graceTimer);
  }
  await server.stop(true);
}

export type ProdFetchHandler = {
  readonly fetchHandler: ProdAppHandle["fetch"];
  readonly cspScriptHashes: readonly string[];
};

// Static-fallback for non-/api/ paths wired via a wrapper so Hono owns
// /api/* + extraRoutes and disk owns the rest. Tests use this directly;
// listen() wraps it in Bun.serve.
export async function buildProdFetchHandler(
  options: RunProdAppOptions,
  config: ProdBootConfig,
  entrypoint: ProdEntrypoint,
): Promise<ProdFetchHandler> {
  const cspScriptHashes = await resolveCspScriptHashes(options.staticDir, options.securityHeaders);
  const hostDispatchScriptHashes =
    options.hostDispatch !== undefined && options.staticDir !== undefined
      ? await resolveHostDispatchScriptHashes(
          options.staticDir,
          options.securityHeaders,
          cspScriptHashes,
        )
      : [];
  const fetchHandler = withSecurityHeaders(
    config.bootOptionWiring.wrapFetch(
      options.staticDir
        ? buildStaticFallback(
            entrypoint.app.fetch.bind(entrypoint.app),
            options.staticDir,
            options.hostDispatch,
            options.resolvePageHead
              ? { resolvePageHead: options.resolvePageHead, dispatcher: entrypoint.dispatcher }
              : undefined,
            entrypoint.dispatcher,
            config.trustedProxyHops ?? 0,
            hostDispatchScriptHashes,
          )
        : // No staticDir (split-deploy / API-only container) → app.fetch's
          // response goes straight to the client, bypassing buildStaticFallback
          // (and with it tryHonoFirst) entirely. Must strip the router-miss
          // marker here too, same reason as the /api/* passthrough in
          // run-prod-app-static-files.ts (see try-hono-first.ts).
          async (req: Request, socketAddress?: string) =>
            stripNoRouteMatchHeader(await entrypoint.app.fetch(req, socketAddress)),
    ),
    options.securityHeaders,
    cspScriptHashes,
  );
  return { fetchHandler, cspScriptHashes };
}

export type ProdAppHandleInput = {
  readonly options: RunProdAppOptions;
  readonly config: ProdBootConfig;
  readonly composed: ProdComposedFeatures;
  readonly connections: ProdConnections;
  readonly entrypoint: ProdEntrypoint;
  readonly fetch: ProdFetchHandler;
  readonly log: Logger;
};

export function createProdAppHandle(input: ProdAppHandleInput): ProdAppHandle {
  const { options, config, composed, connections, entrypoint, log } = input;
  const { fetchHandler, cspScriptHashes } = input.fetch;

  // Upgrade rejections (401/403/426...) are ordinary responses and get the same headers as fetchHandler.
  // Same read-only demo gate as fetchHandler: upgrade requests are GETs, but the socket then writes.
  const securedUpgradeFetch = withSecurityHeaders<KumikoServeEnv>(
    config.bootOptionWiring.wrapFetch<KumikoServeEnv>(async (req, env) =>
      stripNoRouteMatchHeader(await entrypoint.app.fetch(req, env)),
    ),
    options.securityHeaders,
    cspScriptHashes,
  );
  const webSocketUpgradeFetch = async (req: Request, env: KumikoServeEnv): Promise<Response> =>
    securedUpgradeFetch(req, env);

  let uninstallShutdownSignals: (() => void) | undefined;
  let uninstallFatalHandlers: (() => void) | undefined;
  const handle: ProdAppHandle = {
    entrypoint,
    fetch: fetchHandler,
    webSocketUpgradeFetch,
    listen: async (listenPort = config.port) => {
      // Bun.serve provides production HTTP. Tests run under Node, so they call the
      // fetch handler directly instead. buildBunServeOptions centralizes the
      // options shape, including `idleTimeout: 0` for SSE.
      if (typeof Bun === "undefined") {
        // Throw a clear error instead of a raw ReferenceError when listen() is called
        // under Node/vitest without autoListen:false, making the runtime
        // requirement explicit.
        throw new Error(
          "[runProdApp] listen() requires Bun runtime (Bun.serve). " +
            "Under Node/vitest pass `autoListen: false` and call the returned `fetch()` directly.",
        );
      }
      assertNoActiveRowLevelSecurityScope("prod app server");
      handle.server = Bun.serve(
        buildBunServeOptions(
          listenPort,
          fetchHandler,
          options.maxRequestBodySize ?? resolveDerivedMaxRequestBodySize(composed.registry),
          { upgradeFetch: webSocketUpgradeFetch },
        ),
      );

      // SIGTERM/SIGINT — graceful shutdown. Only registered when we
      // actually own a Bun-server, otherwise the test process picks up
      // signals it shouldn't respond to.
      if (options.signals !== false) {
        uninstallShutdownSignals?.();
        uninstallShutdownSignals = installShutdownSignals({
          stop: () => handle.stop(),
          ...(options.signals?.drainTimeoutMs !== undefined && {
            drainTimeoutMs: options.signals.drainTimeoutMs,
          }),
        });
        uninstallFatalHandlers?.();
        uninstallFatalHandlers = installFatalErrorHandlers({
          logger: log,
          stop: () => handle.stop(),
        });
      }

      log.info(`ready on http://0.0.0.0:${listenPort}`);
    },
    stop: async () => {
      uninstallFatalHandlers?.();
      uninstallFatalHandlers = undefined;
      await entrypoint.stop();
      if (handle.server) await stopServerGracefully(handle.server);
      await flushEscapeHatchAudits();
      await connections.closeDb();
      await connections.closeOutsideTransactionDb();
      connections.redis.disconnect();
      await config.bootKms.close();
      uninstallShutdownSignals?.();
      uninstallShutdownSignals = undefined;
      uninstallProcessLogger();
    },
  };
  return handle;
}
