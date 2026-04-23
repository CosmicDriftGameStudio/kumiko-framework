// Dev server bootstrap. Wires the real Kumiko stack behind a Bun.serve
// shell that also bundles the client, serves it at /client.js, mints
// a JWT for a dev-admin on GET /, and broadcasts SSE reloads when
// source files change. One import + one call is enough for any
// sample's server.ts — the 150-line boilerplate of pre-dev-server
// days lives here now.
//
// Not for production:
//   - auto-mints a JWT for TestUsers.admin on every GET / (anyone
//     hitting the server ends up as admin)
//   - bundles the client in-process (prod uses a prebuilt dist)
//   - no rate-limit, no helmet, no secure-cookie flags
//
// The companion prod entry will land at `@kumiko/framework/server`
// with a different options shape (clientDist, auth config, db url).

import { readFile, watch } from "node:fs/promises";
import { resolve } from "node:path";
import type { FeatureDefinition } from "../engine/types";
import { createEventsTable } from "../event-store";
import { ensureEntityTable, setupTestStack, type TestStack, TestUsers } from "../testing";

// Runtime-detection. The dev-server is meant to run under Bun (Kumiko's
// target runtime), but the test-suite runs under vitest on Node — we
// gate every Bun.* call so the module at least LOADS under Node, and
// tests drive the fetch-handler directly instead of going through
// Bun.serve + real sockets.
const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// Bun.serve returns a parametrised Server<WebSocketData>; we don't
// touch WebSockets here, so the narrow `unknown` binding is plenty.
// `Bun` isn't declared in Node types, so we fall back to `unknown`
// and only resolve the type when Bun is actually around.
type BunServer = typeof Bun extends undefined ? unknown : ReturnType<typeof Bun.serve>;

// biome-ignore lint/suspicious/noConsole: dev-server status logging
const logInfo = (msg: string): void => console.log(msg);
// biome-ignore lint/suspicious/noConsole: dev-server error logging
const logError = (...args: unknown[]): void => console.error(...args);

export type CreateKumikoServerOptions = {
  /** Features whose entities, handlers, and screens get wired into the
   *  dev stack. Pass every feature the app is supposed to run. */
  readonly features: readonly FeatureDefinition[];
  /** Absolute path to the browser entry module. The dev-server runs
   *  `Bun.build` on it and serves the output at `/client.js`. Omit to
   *  run a headless API-only dev-stack (rare — every sample has one). */
  readonly clientEntry?: string;
  /** Optional HTML template served at `GET /`. The dev-server injects
   *  a `<script src="/client.js">` and a reload-listener snippet into
   *  `</body>` if those aren't already there. Defaults to a minimal
   *  empty-body document — enough to boot the client. */
  readonly htmlPath?: string;
  /** Port to listen on. Default 4173. Overridable via `PORT` env. */
  readonly port?: number;
  /** Extra directories to watch for reload triggers. The entry's
   *  directory is watched automatically. */
  readonly watchDirs?: readonly string[];
  /** When false, no SIGINT/SIGTERM handlers are installed. Tests set
   *  this so repeated `createKumikoServer` calls don't accumulate
   *  listeners on the process. Default true (dev-server behaviour). */
  readonly installSignalHandlers?: boolean;
};

export type KumikoServerHandle = {
  /** The fetch handler that routes a Request through the dev-server
   *  layer (HTML, /client.js, /_reload, SSE) and falls back to the
   *  underlying Kumiko stack. Tests call this directly to exercise
   *  the routing without going through real sockets. */
  readonly fetch: (req: Request) => Promise<Response>;
  /** Bun.serve instance. `undefined` when running outside Bun (e.g.
   *  in vitest under Node) — the handle still works via `.fetch`. */
  readonly server: BunServer | undefined;
  readonly stack: TestStack;
  /** Stops the server and tears down the stack (DB + redis). */
  readonly stop: () => Promise<void>;
};

const CSRF_COOKIE = "kumiko_csrf";
const AUTH_COOKIE = "kumiko_auth";

// Reload snippet injected into every page-load so the browser
// subscribes to /_reload without the HTML needing to hard-code it.
const RELOAD_SNIPPET = `
<script>
  (() => {
    const es = new EventSource("/_reload");
    es.addEventListener("reload", () => location.reload());
  })();
</script>
`;

// Minimal HTML when the caller didn't hand one in. `#root` is the
// default mount target for `createKumikoApp`, so the one-line client
// can attach without the sample having to ship its own template.
const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Kumiko</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/client.js"></script>
  </body>
</html>
`;

type ClientBundle = { readonly js: string; readonly map: string };

async function buildClient(entry: string): Promise<ClientBundle> {
  if (!hasBun) {
    throw new Error(
      "[kumiko-server] clientEntry is only supported under Bun — Bun.build is unavailable in this runtime.",
    );
  }
  const unminified = process.env["KUMIKO_DEV_UNMINIFIED"] === "1";
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    minify: !unminified,
    sourcemap: "linked",
  });
  if (!built.success) {
    logError("[kumiko-server] client bundle failed:");
    for (const log of built.logs) logError(log);
    throw new Error("client bundle failed");
  }
  const jsOutput = built.outputs.find((o) => o.path.endsWith(".js"));
  const mapOutput = built.outputs.find((o) => o.path.endsWith(".js.map"));
  if (!jsOutput) throw new Error("[kumiko-server] client bundle produced no .js output");
  return {
    js: await jsOutput.text(),
    map: mapOutput ? await mapOutput.text() : "",
  };
}

type ReloadClient = {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly encoder: TextEncoder;
  closed: boolean;
};

function injectReload(html: string): string {
  if (html.includes("/_reload")) return html;
  return html.includes("</body>")
    ? html.replace("</body>", `${RELOAD_SNIPPET}</body>`)
    : html + RELOAD_SNIPPET;
}

async function watchDir(dir: string, onChange: (filename: string) => void): Promise<void> {
  const watcher = watch(dir, { recursive: true });
  for await (const ev of watcher) {
    if (ev.filename) onChange(ev.filename);
  }
}

// Create all entity tables declared by the given features. Uses
// ensureEntityTable so a persistent DB (KUMIKO_DEV_DB_NAME) can
// reuse tables from the previous boot without the caller having to
// check.
async function createEntityTablesForFeatures(
  stack: TestStack,
  features: readonly FeatureDefinition[],
): Promise<void> {
  for (const feature of features) {
    for (const [entityName, entity] of Object.entries(feature.entities)) {
      const created = await ensureEntityTable(stack.db.db, entity, entityName);
      if (!created) {
        logInfo(
          `[kumiko-server] table ${entity.table ?? entityName} already exists — skipping create`,
        );
      }
    }
  }
}

export async function createKumikoServer(
  options: CreateKumikoServerOptions,
): Promise<KumikoServerHandle> {
  const port = options.port ?? Number(process.env["PORT"] ?? 4173);

  // --- client bundle (optional) ---
  let clientBundle: ClientBundle = { js: "", map: "" };
  if (options.clientEntry !== undefined) {
    const entry = resolve(options.clientEntry);
    clientBundle = await buildClient(entry);
    logInfo(
      `[kumiko-server] client bundle: ${clientBundle.js.length.toLocaleString()} bytes` +
        (clientBundle.map
          ? ` (+ ${clientBundle.map.length.toLocaleString()} bytes sourcemap)`
          : ""),
    );
  }

  // --- HTML template ---
  const htmlTemplate =
    options.htmlPath !== undefined
      ? await readFile(resolve(options.htmlPath), "utf-8")
      : DEFAULT_HTML;

  // --- Kumiko stack ---
  // KUMIKO_DEV_DB_NAME switches the underlying testDb from ephemeral
  // (fresh kumiko_test_<random>, dropped on cleanup) to persistent
  // (reuses the named DB across restarts). The var is framework-scoped
  // on purpose — every dev-server pattern benefits from the same
  // toggle, not just one sample.
  const devDbName = process.env["KUMIKO_DEV_DB_NAME"];
  const persistentDb = devDbName !== undefined && devDbName !== "";

  logInfo(
    `[kumiko-server] booting Kumiko stack${
      persistentDb ? ` — persistent DB "${devDbName}"` : " — ephemeral test DB"
    }…`,
  );
  const stack = await setupTestStack({
    features: options.features,
    ...(persistentDb && { dbName: devDbName, persistentDb: true }),
  });
  await createEventsTable(stack.db.db);
  await createEntityTablesForFeatures(stack, options.features);

  // Dev user = TestUsers.admin. Demo features are openToAll but the
  // auth-middleware still needs a valid JWT to let the request past.
  const devUser = TestUsers.admin;

  // --- SSE reload ---
  const reloadClients = new Set<ReloadClient>();
  const broadcastReload = (): void => {
    const payload = "event: reload\ndata: now\n\n";
    for (const client of reloadClients) {
      if (client.closed) continue;
      try {
        client.controller.enqueue(client.encoder.encode(payload));
      } catch {
        client.closed = true;
      }
    }
  };

  // Build a fresh HTML response with JWT/CSRF cookies. Used by the
  // SPA-catch-all so any deep-link (/, /task-list, /task-edit/<uuid>…)
  // mints a working session and lets the client boot from that URL.
  const htmlResponse = async (): Promise<Response> => {
    const jwt = await stack.jwt.sign(devUser);
    const csrf = crypto.randomUUID();
    const headers = new Headers();
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.append("Set-Cookie", `${AUTH_COOKIE}=${jwt}; Path=/; HttpOnly; SameSite=Lax`);
    headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax`);
    return new Response(injectReload(htmlTemplate), { headers });
  };

  // --- Fetch handler (runtime-neutral) ---
  const handleFetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Specific routes first — assets, reload-SSE, API.
    if (url.pathname === "/client.js" && req.method === "GET") {
      return new Response(clientBundle.js, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }

    if (url.pathname === "/client.js.map" && req.method === "GET") {
      if (!clientBundle.map) return new Response("no map", { status: 404 });
      return new Response(clientBundle.map, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (url.pathname === "/_reload" && req.method === "GET") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const entry: ReloadClient = { controller, encoder, closed: false };
          reloadClients.add(entry);
          controller.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          for (const c of reloadClients) {
            if (c.closed) reloadClients.delete(c);
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // SPA catch-all: any GET to a non-API, non-asset path returns the
    // HTML shell. The client-side router then reads location.pathname
    // and mounts the right screen. The "no dot" filter skips
    // /favicon.ico etc. (let the stack's 404 handler respond).
    if (req.method === "GET" && !url.pathname.startsWith("/api/") && !url.pathname.includes(".")) {
      return htmlResponse();
    }

    return stack.app.fetch(req);
  };

  // --- HTTP server (Bun only) ---
  // Under Node/vitest we skip Bun.serve entirely — the handle's
  // .fetch() is the test surface. Real dev runs under Bun, where
  // Bun.serve wires the listener.
  const server = hasBun
    ? (globalThis as { Bun: { serve: (opts: unknown) => BunServer } }).Bun.serve({
        port,
        fetch: handleFetch,
      })
    : undefined;

  // --- file watcher → rebundle + reload ---
  if (options.clientEntry !== undefined) {
    const entry = resolve(options.clientEntry);
    const entryDir = resolve(entry, "..");
    const dirs = [entryDir, ...(options.watchDirs ?? []).map((d) => resolve(d))];
    for (const dir of dirs) {
      void watchDir(dir, async (filename) => {
        // skip: nur TS-Änderungen triggern ein Rebuild — CSS/HTML fließen
        // über den separaten Public-Watcher ein (falls eingerichtet).
        if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) return;
        try {
          clientBundle = await buildClient(entry);
          logInfo(`[kumiko-server] rebuilt on ${filename}, broadcasting reload`);
          broadcastReload();
        } catch {
          // buildClient already logged the failure; keep serving the
          // last good bundle until the next successful rebuild.
        }
      });
    }
  }

  const stop = async (): Promise<void> => {
    if (server !== undefined) {
      (server as { stop: (closeActive?: boolean) => void }).stop(true);
    }
    await stack.cleanup();
  };

  // --- graceful shutdown ---
  // Signal handlers fire on Ctrl-C / kill. Without them, repeated dev
  // restarts leak Postgres pools and (in persistent mode) leave
  // temporary clients dangling.
  const installHandlers = options.installSignalHandlers ?? true;
  if (installHandlers) {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.on(sig, async () => {
        logInfo(`[kumiko-server] ${sig} — cleaning up…`);
        await stop();
        process.exit(0);
      });
    }
  }

  if (server !== undefined) {
    logInfo(
      `[kumiko-server] listening on http://localhost:${port}` +
        (options.clientEntry !== undefined ? " (hot reload on client entry dir)" : ""),
    );
  }

  return { fetch: handleFetch, server, stack, stop };
}
