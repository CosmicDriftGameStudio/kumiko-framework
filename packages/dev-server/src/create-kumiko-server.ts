/// <reference types="bun-types" preserve="true" />
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
// The companion prod entry will land at `@cosmicdrift/kumiko-framework/server`
// with a different options shape (clientDist, auth config, db url).

import type { AuthRoutesConfig, ExtraRouteDefinition } from "@cosmicdrift/kumiko-framework/api";
import {
  assertNoActiveRowLevelSecurityScope,
  type RowLevelSecurityMode,
} from "@cosmicdrift/kumiko-framework/db";
import { buildAppSchema, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { ErrorDocsConfig } from "@cosmicdrift/kumiko-framework/errors";
import type {
  PageHeadResolver,
  PageHeadSystemQuery,
} from "@cosmicdrift/kumiko-renderer/headless/apex";
import {
  buildBunServeOptions,
  resolveDerivedMaxRequestBodySize,
} from "@cosmicdrift/kumiko-server-runtime/bun-serve-options";
import type { SystemWireDeps } from "@cosmicdrift/kumiko-server-runtime/extra-routes-deps";
import { stripNoRouteMatchHeader } from "@cosmicdrift/kumiko-server-runtime/try-hono-first";
import type { TestStack, TestStackOptions } from "@cosmicdrift/kumiko-testing/stack";
import {
  buildClient,
  buildClientBundles,
  normalizeEntries,
} from "./create-kumiko-server-client-bundles.ts";
import { loadHtmlTemplates } from "./create-kumiko-server-html.ts";
import { createReloadHub } from "./create-kumiko-server-reload.ts";
import { createDevFetchHandler, type DevFetchHandler } from "./create-kumiko-server-routes.ts";
import { createDevServerStop, installDevSignalHandlers } from "./create-kumiko-server-shutdown.ts";
import {
  bootDevStack,
  resolveDevDbMode,
  startDevBackgroundRunners,
} from "./create-kumiko-server-stack.ts";
import { startDevStylesheet } from "./create-kumiko-server-stylesheet.ts";
import { type DirectoryWatchEvents, startDevFileWatchers } from "./create-kumiko-server-watcher.ts";
import { type BunServer, hasBun, logInfo } from "./dev-server-runtime.ts";

/** Multi-entry mode for apps that ship several separate bundles (e.g.
 *  publicstatus: `admin.<base>` loads the admin UI, otherwise the public
 *  page).
 *
 *  kumiko-build reads the same entry list from package.json
 *  `kumiko.clientEntries` and serves `/client-<name>.js` per HTTP — the
 *  dev server and the prod build stay in sync via that shared declaration,
 *  not a filename convention. Mutually exclusive with `clientEntry`.
 *  Multi-entry apps MUST also set `hostDispatch` — otherwise the server
 *  has no way to know which HTML to serve. */
export type DevClientEntry = {
  /** Logical name. Should match the corresponding package.json
   *  `kumiko.clientEntries[].name` so dev and prod produce identical
   *  asset URLs (`/client-<name>.js`). */
  readonly name: string;
  /** Absolute path to the browser entry file. */
  readonly sourceFile: string;
  /** Optional HTML template for this entry. If omitted, `htmlPath` (the default template) is used for all entries. */
  readonly htmlPath?: string;
};

/** Dev counterpart of `runProdApp.hostDispatch`. Not the same shape: dev names
 *  bundled entries (`entryName`), prod serves built files (`file`). Derive the
 *  dev dispatch from the prod one with `toDevHostDispatch` (host-dispatch-adapter.ts)
 *  instead of writing both by hand, so dev routing cannot drift from prod. HTML never carries
 *  a schema, in dev or prod — createKumikoApp fetches it itself from the
 *  authenticated GET /api/schema. */
export type DevHostDispatchResult =
  | {
      readonly kind: "html";
      readonly entryName: string;
      /** @deprecated Ignored — HTML never carries the schema; createKumikoApp
       *  fetches it from the authenticated GET /api/schema. Removed in 0.390.0. */
      readonly injectSchema?: boolean;
    }
  | {
      /** Static HTML: serves a file verbatim, no bundle injection. Mirrors
       *  prod's `{ kind: "html", file: ... }` for marketing/apex pages that
       *  don't need React. Path relative to the server CWD. */
      readonly kind: "static-html";
      readonly file: string;
    }
  | { readonly kind: "redirect"; readonly to: string; readonly status?: 301 | 302 }
  | {
      /** Plain 404 by default. `file` serves a static page with status 404
       *  (like `static-html`), `entryName` serves that bundle's shell with 404;
       *  `file` wins when both are set. */
      readonly kind: "not-found";
      readonly entryName?: string;
      readonly file?: string;
    };

/** Picks an entry by inspecting the incoming request. Set by multi-entry apps; irrelevant in single-entry mode. */
export type DevHostDispatch = (
  req: Request,
  deps: {
    readonly systemQuery: PageHeadSystemQuery;
    /** Always empty: dev serves no per-host CSP. */
    readonly cspScriptHashes: readonly string[];
  },
) => DevHostDispatchResult | Promise<DevHostDispatchResult>;

export type CreateKumikoServerOptions = {
  /** Row level security of the dev stack, as in prod. Default "on", so tenant-isolation bugs show up in development. */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
  /** Features whose entities, handlers, and screens get wired into the
   *  dev stack. Pass every feature the app is supposed to run. */
  readonly features: readonly FeatureDefinition[];
  /** Absolute path to the browser entry module. The dev server runs
   *  `Bun.build` on it and serves the output at `/client.js`. Omit to
   *  run a headless API-only dev stack. Mutually exclusive with
   *  `clientEntries`. */
  readonly clientEntry?: string;
  /** Multi-entry mode: separate bundles served at
   *  `/client-<name>.js`. Mutually exclusive with `clientEntry`. Set
   *  `hostDispatch` as well; otherwise the server cannot determine which
   *  template to return. */
  readonly clientEntries?: readonly DevClientEntry[];
  /** Multi-entry request routing. Inspects `Host` (or another request
   *  property) and returns a discriminated union
   *  (`html` → entry bundle, `redirect` → 30x, `not-found` → 404).
   *  Mirrors `runProdApp.hostDispatch` so dev and production routing
   *  remain aligned. */
  readonly hostDispatch?: DevHostDispatch;
  /** @internal — replaces `Bun.build` in tests. The default uses the real
   *  Bun toolchain; Node-based tests inject a stub so the routing path can
   *  run without calling Bun.build.
   *  Not part of the public API; the `_` prefix identifies this test seam. */
  readonly _buildBundle?: (sourceFile: string) => Promise<{
    readonly js: string;
    readonly map: string;
  }>;
  /** @internal — replaces the native directory watcher in tests. */
  readonly _watchDirectory?: DirectoryWatchEvents;
  /** Absolute path to the CSS entry (typically styles.css with
   *  @import "tailwindcss"). The dev-server builds it with the Tailwind
   *  CLI and serves the result at /styles.css; `stylesheetWatch` decides
   *  whether the CLI keeps running with `--watch` afterwards.
   *
   *  When `undefined` and a client entry is set, the app's own
   *  src/styles.css wins, otherwise `@cosmicdrift/kumiko-renderer/web/styles.css`
   *  resolves via package exports, so no sample hardcodes a monorepo-relative path.
   *
   *  `stylesheet: false` disables the CSS pipeline. */
  readonly stylesheet?: string | false;
  /** `true`: the Tailwind CLI keeps running with `--watch` after the
   *  initial build. `false`: CSS is built once at boot, no watcher.
   *  When `undefined`, env `KUMIKO_DEV_STYLESHEET_WATCH=0` means `false`,
   *  anything else `true`. `defineAppE2eConfig` sets that env: Tailwind v4
   *  subscribes to the whole app cwd without a gitignore filter, so every
   *  Playwright artifact write under test-results/ would trigger a rebuild. */
  readonly stylesheetWatch?: boolean;
  /** Optional HTML template served at `GET /`. The dev-server injects
   *  a `<script type="module" src="/client.js">` and a reload-listener
   *  snippet into `</body>` if those aren't already there. Defaults to a
   *  minimal empty-body document — enough to boot the client. */
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
  /** Auth route configuration (login, tenants, switch-tenant, logout). When
   *  set, disables automatic JWT minting on GET /; the client is responsible
   *  for login. The corresponding features (user/tenant/auth-email-password)
   *  must also be included through `features` for these routes to work. */
  readonly auth?: AuthRoutesConfig;
  /** Additional AppContext keys, such as `configResolver` for the config
   *  feature. Forwarded to `setupTestStack`; see `TestStackOptions` for
   *  the accepted shapes (object or factory function). */
  readonly extraContext?: TestStackOptions["extraContext"];
  /** Enables anonymous access: requests without a JWT proceed as a
   *  pseudo-user with the `anonymous` role when the handler declares
   *  `roles: ["anonymous"]`. Tenant resolution uses a header, cookie, or
   *  default; see `AnonymousAccessConfig`. */
  readonly anonymousAccess?: TestStackOptions["anonymousAccess"];
  /** File-storage provider forwarded to `setupTestStack`. When set, the
   *  stack mounts the upload routes (POST/GET/DELETE /api/files), exposes
   *  `ctx.files`, and creates the `file_refs` table. Example:
   *  `{ storageProvider: createInMemoryFileProvider() }`. */
  readonly files?: TestStackOptions["files"];
  /** Feature-toggle resolver forwarded to `setupTestStack`. When set, the
   *  dispatcher feature gate, hook filter, and MSP filter consult it;
   *  absent means all features remain enabled. Required for per-tenant
   *  feature composition. The typical production implementation is
   *  `() => globalFeatureToggleRuntime.effectiveFeatures` after boot,
   *  using the createLateBoundHolder pattern because the runtime needs
   *  `stack.db`. */
  readonly effectiveFeatures?: TestStackOptions["effectiveFeatures"];
  /** Called after entity tables are set up. Use this hook for non-entity
   *  tables (`unsafePushTables`) and seeding (admin user, initial tenant,
   *  and so on). Must be idempotent because persistent-DB mode runs it on
   *  every boot. */
  readonly onAfterSetup?: (stack: TestStack) => Promise<void>;
  /** Declarative HTTP-routes outside the /api/write|query|batch pipeline —
   *  symmetric to runProdApp.extraRoutes. Mounted
   *  inside buildServer (setupTestStack), before the Static/HTML-fallback,
   *  so an own GET (/feed.xml, /og-image, …) wins over the dev-asset path. */
  readonly extraRoutes?: readonly ExtraRouteDefinition[];
  /** Forwarded to setupTestStack → buildServer's top-level
   *  `ServerOptions.trustedProxyHops`. Dev usually runs unproxied, so this
   *  is normally left unset (default 0). */
  readonly trustedProxyHops?: number;
  /** Links the app's own error reasons to its own docs (`docsUrl` in error responses); framework reasons keep the framework docs link. */
  readonly errorDocs?: ErrorDocsConfig;
  /** Hook for app-wired co-running components that need the system-write
   *  dispatcher — runs after buildServer, before onAfterSetup (seeds), with
   *  NO `app` (routes are declared via `extraRoutes`, not wired here). */
  readonly wire?: (deps: SystemWireDeps) => void | Promise<void>;
  /** Per-request head-metadata resolver (Open-Graph/title/description) —
   *  same option, same `PageHeadResolver` signature, and same shared
   *  resolve+inject call (`resolveAndInjectPageHead`) as `runProdApp`'s
   *  `resolvePageHead`, so dev and e2e exercise the exact code prod does.
   *  Consulted for every templated HTML response
   *  (the default single-entry shell and a host-dispatched `"html"` entry),
   *  right before it's served. On error, `null`, or a timeout, the shell
   *  ships unchanged with status 200 — never a 500. `systemQuery` inside
   *  the resolver runs as the anonymous role, same as prod. */
  readonly resolvePageHead?: PageHeadResolver;
  /** Wraps the request handler before it reaches Bun.serve and `handle.fetch`, e.g. the demo read-only gate. */
  readonly wrapFetch?: (
    handler: (req: Request, socketAddress?: string) => Promise<Response>,
  ) => (req: Request, socketAddress?: string) => Promise<Response>;
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
  /** BullMQ queue-name prefix of this boot: per-boot in ephemeral mode, so
   *  its `bull:<prefix>-*` keys belong to this server alone on a shared Redis. */
  readonly jobQueueNamePrefix: string;
};

// Under Node the handle's .fetch() is the test surface. Bun.serve options come
// from buildBunServeOptions (run-prod-app.ts) so development and production
// share the same SSE-relevant defaults (idleTimeout: 0);
// run-prod-app-spec.test.ts pins that.
function startDevHttpServer(
  port: number,
  handleFetch: DevFetchHandler,
  stack: TestStack,
): BunServer | undefined {
  if (!hasBun) return undefined;
  assertNoActiveRowLevelSecurityScope("dev server");
  return Bun.serve(
    buildBunServeOptions(port, handleFetch, resolveDerivedMaxRequestBodySize(stack.registry), {
      upgradeFetch: async (req, env) => stripNoRouteMatchHeader(await stack.app.fetch(req, env)),
    }),
  );
}

export async function createKumikoServer(
  options: CreateKumikoServerOptions,
): Promise<KumikoServerHandle> {
  const port = options.port ?? Number(process.env["PORT"] ?? 4173);
  const entries = normalizeEntries(options);
  const buildBundle = options._buildBundle ?? buildClient;
  const clientBundles = await buildClientBundles(entries, buildBundle);
  const stylesheet = await startDevStylesheet(options);
  const templates = await loadHtmlTemplates(entries, options.htmlPath);

  const dbMode = resolveDevDbMode(process.env);
  const stack = await bootDevStack(options, dbMode);
  const devJobRunners = await startDevBackgroundRunners(stack, dbMode.jobQueueNamePrefix);
  // Built once purely to surface authoring warnings (settings-hub placement
  // etc.) at the same point prod would; clients fetch the schema themselves
  // from GET /api/schema, so the result is discarded.
  buildAppSchema(stack.registry, {
    authoringWarnings: true,
    searchAdapterMissing: !stack.context.searchAdapter,
  });

  const reloadHub = createReloadHub();
  const handleFetch = createDevFetchHandler({
    options,
    stack,
    entries,
    clientBundles,
    templates,
    stylesheetPath: stylesheet?.outPath,
    reloadHub,
  });
  const server = startDevHttpServer(port, handleFetch, stack);

  const watcherAbort = new AbortController();
  const stop = createDevServerStop({
    watcherAbort,
    killTailwind: stylesheet?.kill,
    server,
    stack,
    devJobRunners,
    dbMode,
  });
  startDevFileWatchers({
    entries,
    watchDirs: options.watchDirs,
    watchDirectory: options._watchDirectory,
    signal: watcherAbort.signal,
    buildBundle,
    clientBundles,
    reloadHub,
    stop,
  });
  if (options.installSignalHandlers ?? true) installDevSignalHandlers(stop);

  if (server !== undefined) {
    logInfo(
      `[kumiko-server] listening on http://localhost:${port}` +
        (entries.length > 0
          ? ` (hot reload on ${entries.length === 1 ? "client entry" : `${entries.length} entries`})`
          : ""),
    );
  }
  return { fetch: handleFetch, server, stack, stop, jobQueueNamePrefix: dbMode.jobQueueNamePrefix };
}
