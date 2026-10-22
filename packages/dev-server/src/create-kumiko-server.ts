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

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { readFile, realpath, watch } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { resolveAnonymousAccessFromRegistry } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  AUTH_COOKIE_BASE,
  type AuthRoutesConfig,
  CSRF_COOKIE_BASE,
  createClientIpResolver,
  type ExtraRouteDefinition,
  generateToken,
  sessionCookieName,
} from "@cosmicdrift/kumiko-framework/api";
import { buildAppSchema, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import type { ErrorDocsConfig } from "@cosmicdrift/kumiko-framework/errors";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { rankPreferredLocales } from "@cosmicdrift/kumiko-framework/i18n";
import { createMetricsForFactory } from "@cosmicdrift/kumiko-framework/observability";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  type PageHeadResolver,
  type PageHeadSystemQuery,
  resolveAndInjectPageHead,
} from "@cosmicdrift/kumiko-renderer/headless/apex";
import { startDevJobRunners } from "@cosmicdrift/kumiko-server-runtime/boot/job-run-logger";
import {
  buildBunServeOptions,
  resolveDerivedMaxRequestBodySize,
} from "@cosmicdrift/kumiko-server-runtime/bun-serve-options";
import {
  makeDispatchSystemQuery,
  makeDispatchSystemWrite,
  type SystemWireDeps,
} from "@cosmicdrift/kumiko-server-runtime/extra-routes-deps";
import {
  RENDERER_WEB_FONT_FILE_PATTERN,
  RENDERER_WEB_FONTS_URL_PREFIX,
  resolveRendererWebFontsDir,
} from "@cosmicdrift/kumiko-server-runtime/renderer-web-fonts";
import { buildRequestBoundSystemQuery } from "@cosmicdrift/kumiko-server-runtime/request-bound-system-query";
import {
  canResolveTailwindStylesheet,
  resolveTailwindCli,
} from "@cosmicdrift/kumiko-server-runtime/resolve-tailwind-cli";
import {
  type HonoLikeApp,
  stripNoRouteMatchHeader,
  tryHonoFirst,
} from "@cosmicdrift/kumiko-server-runtime/try-hono-first";
import {
  pushEntityProjectionTables,
  setupTestStack,
  type TestStack,
  type TestStackOptions,
} from "@cosmicdrift/kumiko-testing/stack";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import { isPersistentDevDb } from "./is-persistent-dev-db.ts";

// Runtime-detection. The dev-server is meant to run under Bun (Kumiko's
// target runtime), but the test-suite runs under vitest on Node — we
// gate every Bun.* call so the module at least LOADS under Node, and
// tests drive the fetch-handler directly instead of going through
// Bun.serve + real sockets.
const hasBun = typeof Bun !== "undefined";

// Bun.serve returns a parametrised Server<WebSocketData>; nothing here reads
// the socket data, so the narrow `unknown` binding is plenty.
// `Bun` isn't declared in Node types, so we fall back to `unknown`
// and only resolve the type when Bun is actually around.
type BunServer = typeof Bun extends undefined ? unknown : ReturnType<typeof Bun.serve>;

// @wrapper-known semantic-alias
// biome-ignore lint/suspicious/noConsole: dev-server status logging
export const logInfo = (msg: string): void => console.log(msg);
// @wrapper-known semantic-alias
// biome-ignore lint/suspicious/noConsole: dev-server error logging
const logError = (...args: unknown[]): void => console.error(...args);

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

// The dev server speaks plain http, so its minted cookies are never Secure and keep the unprefixed names.
const CSRF_COOKIE = sessionCookieName(CSRF_COOKIE_BASE, { secure: false });
const AUTH_COOKIE = sessionCookieName(AUTH_COOKIE_BASE, { secure: false });

// Duplicated in packages/testing/src/e2e/constants.ts: the Playwright config
// runs under Node and cannot import this module.
export const STYLESHEET_WATCH_ENV = "KUMIKO_DEV_STYLESHEET_WATCH";

// Duplicated in packages/testing/src/e2e/constants.ts: the Playwright config
// runs under Node and cannot import this module.
export const PROD_BUNDLES_ENV = "KUMIKO_DEV_PROD_BUNDLES";

// Reload snippet injected into every page-load so the browser
// subscribes to /_reload without the HTML needing to hard-code it.
//
// Two reload triggers:
//   - explicit `reload` event from the server after hot reload (rebuild + send)
//   - implicit `boot` event on every SSE connection, containing the current
//     server process's bootId. The snippet remembers the first bootId; if a
//     reconnect receives a different one, it refreshes. Otherwise the
//     browser could remain on a stale bundle after a server restart.
const RELOAD_SNIPPET = `
<script>
  (() => {
    const es = new EventSource("/_reload");
    let firstBootId = null;
    es.addEventListener("boot", (e) => {
      if (firstBootId === null) {
        firstBootId = e.data;
      } else if (firstBootId !== e.data) {
        location.reload();
      }
    });
    es.addEventListener("reload", () => location.reload());
  })();
</script>
`;

// Minimal HTML when the caller didn't hand one in. `#root` is the
// default mount target for `createKumikoApp`, so the one-line client
// can attach without the sample having to ship its own template.
//
// `type="module"` is load-bearing: a classic script turns the bundle's
// top-level declarations into window properties, so a dependency exporting
// `function history()` (prosemirror-history, pulled in by tiptap) silently
// replaces `window.history` and every pushState afterwards throws. Prod
// (build-prod-bundle) has always emitted the module form.
//
// `interactive-widget=resizes-content`: without it, a mobile
// keyboard shrinks only the visual viewport, not the layout viewport that
// `position: fixed` anchors to — a fixed bottom action bar would stay
// pinned behind the keyboard instead of above it. iOS Safari ignores the
// key; renderer/web's useKeyboardInset covers it via window.visualViewport.
export const DEFAULT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content" />
    <title>Kumiko</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

type ClientBundle = {
  readonly js: string;
  readonly map: string;
  // Only set when PROD_BUNDLES_ENV builds with splitting. Path -> content,
  // e.g. "/chunk-abc123.js" -> "...".
  readonly chunks?: ReadonlyMap<string, string>;
};

async function buildClient(entry: string): Promise<ClientBundle> {
  if (!hasBun) {
    throw new Error(
      "[kumiko-server] clientEntry is only supported under Bun — Bun.build is unavailable in this runtime.",
    );
  }
  const unminified = process.env["KUMIKO_DEV_UNMINIFIED"] === "1";
  // Same splitting/sourcemap/NODE_ENV as build-prod-bundle.ts, opt-in via
  // env so `bun dev` stays unchanged.
  const prodShaped = process.env[PROD_BUNDLES_ENV] === "1";
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    minify: !unminified,
    sourcemap: prodShaped ? "none" : "linked",
    splitting: prodShaped,
    ...(prodShaped ? { define: { "process.env.NODE_ENV": JSON.stringify("production") } } : {}),
  });
  if (!built.success) {
    logError("[kumiko-server] client bundle failed:");
    for (const log of built.logs) logError(log);
    throw new Error("client bundle failed");
  }
  const jsOutput = built.outputs.find((o) => o.kind === "entry-point");
  const mapOutput = built.outputs.find((o) => o.path.endsWith(".js.map"));
  if (!jsOutput) throw new Error("[kumiko-server] client bundle produced no .js output");
  const chunks = new Map<string, string>();
  for (const output of built.outputs) {
    if (output.kind !== "chunk") continue;
    const chunkPath = `/${output.path.replace(/^\.\//, "")}`;
    chunks.set(chunkPath, await output.text());
  }
  return {
    js: await jsOutput.text(),
    map: mapOutput ? await mapOutput.text() : "",
    chunks,
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

// Injects <link rel="stylesheet" href="/styles.css"> into <head> if it
// is not already present. Called only when the stylesheet option is used;
// otherwise no CSS route is provided.
function injectStylesheet(html: string): string {
  if (html.includes('href="/styles.css"')) return html;
  const link = '<link rel="stylesheet" href="/styles.css" />';
  return html.includes("</head>")
    ? html.replace("</head>", `  ${link}\n</head>`)
    : `${link}${html}`;
}

// GET/HEAD to a non-API, non-SSE path — the dispatch-worthy set shared by
// the SPA catch-all and the public/-file lookup below (they split on
// whether the path has a dot).
function isRoutableGetOrHead(req: Request, pathname: string): boolean {
  return (
    (req.method === "GET" || req.method === "HEAD") &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/sse")
  );
}

// Resolves a request pathname to a file inside publicDir, or undefined if
// it isn't one. Two traversal vectors, both must be blocked:
//   - literal ".." segments (new URL() already collapses these in
//     `pathname`, but resolve()+containment is checked regardless — no
//     path-safety may depend on caller behavior upstream).
//   - percent-encoded slashes (e.g. "%2e%2e%2f"): WHATWG URL parsing only
//     normalizes dot-segments that are delimited by a literal "/", so an
//     encoded slash survives into `pathname` untouched. decodeURIComponent
//     resolves it to "../" before the containment check runs.
function resolvePublicFilePath(pathname: string, publicDir: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  // A NUL byte makes readFile throw ERR_INVALID_ARG_VALUE (not ENOENT), which
  // would surface as a 500 instead of a router miss.
  if (decoded.includes("\0")) return undefined;
  const resolved = resolve(publicDir, `.${decoded}`);
  return resolved === publicDir || resolved.startsWith(publicDir + sep) ? resolved : undefined;
}

// Same extension → content-type mapping as prod's
// run-prod-app-static-files.ts#mimeTypeFor — that function isn't part of
// server-runtime's public exports (its own package.json "exports" map),
// so this is a small self-contained copy rather than a new cross-package
// export for one call site.
const PUBLIC_FILE_MIME_TYPES = new Map<string, string>([
  ["html", "text/html; charset=utf-8"],
  ["js", "text/javascript; charset=utf-8"],
  ["mjs", "text/javascript; charset=utf-8"],
  ["css", "text/css; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["svg", "image/svg+xml"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["ico", "image/x-icon"],
  ["txt", "text/plain; charset=utf-8"],
  ["xml", "application/xml; charset=utf-8"],
  ["webmanifest", "application/manifest+json"],
  ["woff2", "font/woff2"],
]);

function publicFileMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  return PUBLIC_FILE_MIME_TYPES.get(ext) ?? "application/octet-stream";
}

// Reads a file under publicDir for the dev-server's static-asset fallback
// (dev-parity with prod's disk lookup in buildStaticFallback). undefined
// means "not a servable file here" — caller treats that as a router miss,
// same as ENOENT/EISDIR/ENOTDIR further down.
async function servePublicFile(
  pathname: string,
  publicDir: string,
): Promise<{ readonly bytes: Uint8Array; readonly mime: string } | undefined> {
  const filePath = resolvePublicFilePath(pathname, publicDir);
  if (filePath === undefined) return undefined;
  try {
    // Lexical containment (above) only catches "..", not a symlink inside
    // publicDir that points outside it on disk — realpath resolves the
    // actual target and the same containment check runs against it. Read
    // from the resolved path so the checked target is the one read.
    const real = await realpath(filePath);
    if (real !== publicDir && !real.startsWith(publicDir + sep)) return undefined;
    const bytes = await readFile(real);
    return { bytes, mime: publicFileMimeType(filePath) };
  } catch (err) {
    const code = errorCodeOf(err);
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR" || code === "ENAMETOOLONG") {
      return undefined;
    }
    throw err;
  }
}

// Static assets under public/ — prod serves these via buildStaticFallback's
// disk lookup (run-prod-app-static-files.ts), dev previously had no
// equivalent: a dotted path (e.g. /marketing/hero.png) fell straight
// through to the API stack and 404ed. Hono still goes first (an
// r.httpRoute could itself own a dotted path), then the file on disk,
// then the router-miss 404 — mirrors handleFetch's SPA branch. undefined
// means "not a static-asset request", caller falls through to the next
// route.
async function tryServePublicAsset(
  req: Request,
  pathname: string,
  app: HonoLikeApp,
  publicDir: string,
  socketAddress?: string,
): Promise<Response | undefined> {
  if (!isRoutableGetOrHead(req, pathname) || !pathname.includes(".")) return undefined;
  const honoTry = await tryHonoFirst(app, req, socketAddress);
  if (honoTry.matched) {
    return honoTry.response;
  }
  const file = await servePublicFile(pathname, publicDir);
  if (file !== undefined) {
    // @cast-boundary Buffer satisfies BodyInit at runtime, bun-types
    // just doesn't say so — same cast run-prod-app-static-files.ts uses.
    return new Response(file.bytes as unknown as BodyInit, {
      headers: { "Content-Type": file.mime },
    });
  }
  return honoTry.response;
}

type DirectoryWatchEvents = (
  dir: string,
  options: { readonly recursive: true; readonly signal: AbortSignal },
) => AsyncIterable<{ readonly filename: string | null }>;

async function watchDir(
  dir: string,
  onChange: (filename: string) => void,
  signal: AbortSignal,
  watchEvents: DirectoryWatchEvents,
): Promise<void> {
  // The server's stop() aborts the signal; without it, the for-await loop
  // would continue until process exit. During test teardown, removing the
  // temporary directory could then be classified as a restart and call
  // process.exit(75), surfacing as an unhandled Vitest error.
  const watcher = watchEvents(dir, { recursive: true, signal });
  try {
    for await (const ev of watcher) {
      if (ev.filename) onChange(ev.filename);
    }
  } catch (err) {
    // signal.abort() causes the async iterator to throw AbortError during
    // expected teardown; other errors must propagate.
    // skip: AbortSignal fired the abort, this is expected teardown not a real error
    if (typeof err === "object" && err !== null && "name" in err && err.name === "AbortError")
      return;
    throw err;
  }
}

// Classifies a changed file as `hot-reload` for client-side changes,
// `restart` for server-side changes whose cached Bun modules must be
// reloaded, or `ignore` when the server is unaffected.
//
// Tests and non-TypeScript files are ignored. TypeScript files under
// `/web/`, `/admin/`, `/public/`, or `/client/`, as well as the client
// entry itself, trigger hot reload; other TypeScript files trigger a
// restart because they may contain schema or feature definitions.
//
// The multiple client directories are intentional: samples use different
// layouts. Restarting for a client-only edit would be slower, drop the
// ephemeral test database, and reseed it unnecessarily.
//
// Exported for tests; internally called by the watcher loop.
export function classifyChange(filename: string): "restart" | "hot-reload" | "ignore" {
  if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) return "ignore";
  if (filename.includes("__tests__")) return "ignore";
  if (filename.endsWith(".test.ts") || filename.endsWith(".test.tsx")) return "ignore";
  if (
    filename.endsWith(".integration.ts") ||
    filename.endsWith(".integration.test.ts") ||
    filename.endsWith(".e2e.ts")
  ) {
    return "ignore";
  }
  // Platform-independent: checks both POSIX and Windows separators.
  // Matches `<sep><dir><sep>` and trailing-`<sep><dir>` for watcher
  // filenames supplied as relative paths.
  const clientSubdirs = ["web", "admin", "public", "client"];
  for (const dir of clientSubdirs) {
    if (
      filename.includes(`/${dir}/`) ||
      filename.includes(`\\${dir}\\`) ||
      filename.startsWith(`${dir}/`) ||
      filename.startsWith(`${dir}\\`)
    ) {
      return "hot-reload";
    }
  }
  if (filename.endsWith("/client.tsx") || filename.endsWith("/client.ts")) {
    return "hot-reload";
  }
  return "restart";
}

// The watcher reports paths relative to the watched directory, so an entry arrives as a bare
// "client.tsx" (or a custom name like "client-admin.tsx") that classifyChange alone reads as a
// server file and answers with a restart.
export function classifyWatchedChange(
  watchedDir: string,
  filename: string,
  entrySourceFiles: ReadonlySet<string>,
): ReturnType<typeof classifyChange> {
  return entrySourceFiles.has(resolve(watchedDir, filename))
    ? "hot-reload"
    : classifyChange(filename);
}

// Expands watchDirs patterns into concrete directories. Entries without
// `*` are resolved as ordinary paths; entries with `*` are glob-expanded
// and only directory matches are retained, so `"../../../packages/*/src"`
// replaces a list of hard-coded paths. Expansion runs once at boot,
// not while the watcher is running.
function expandWatchPatterns(patterns: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of patterns) {
    if (!p.includes("*")) {
      out.push(resolve(p));
      continue;
    }
    // Only reachable under Bun (createKumikoServer is Bun-only); without Bun the
    // call stack fails fast in Bun.serve anyway.
    if (typeof Bun === "undefined") throw new Error("expandWatchPatterns requires Bun.Glob");
    const glob = new Bun.Glob(p);
    const matches = Array.from(glob.scanSync({ onlyFiles: false, cwd: process.cwd() }));
    for (const m of matches) {
      const abs = resolve(m);
      try {
        if (statSync(abs).isDirectory()) out.push(abs);
      } catch {
        // ignore unreadable matches — typisch defekte Symlinks
      }
    }
  }
  return out;
}

// Resolves the path to the Tailwind entry CSS:
//   - explicit string  → the resolved absolute path
//   - false            → CSS pipeline off (undefined)
//   - undefined + client entries:
//       1. the app's own src/styles.css (theme override) if present
//       2. else the default `@cosmicdrift/kumiko-renderer/web/styles.css` via package exports
//   - undefined + no client entry: undefined (no CSS needed)
//
// The src/styles.css auto-detection mirrors build-prod-bundle:resolveStylesheetEntry
// so dev and prod resolve identically. Without it every app would have to set
// `stylesheet: "./src/styles.css"`, or dev would fall back to the default and
// ignore the brand tokens.
//
// @internal — exported for unit tests only, not re-exported from the package index.
export function resolveStylesheet(options: CreateKumikoServerOptions): string | undefined {
  if (options.stylesheet === false) return undefined;
  if (typeof options.stylesheet === "string") return resolve(options.stylesheet);
  const hasAnyEntry =
    options.clientEntry !== undefined ||
    (options.clientEntries !== undefined && options.clientEntries.length > 0);
  if (!hasAnyEntry) return undefined;

  // The app's own src/styles.css beats the renderer/web default, same as
  // kumiko-build, so local and prod builds match.
  const local = resolve(process.cwd(), "src/styles.css");
  if (existsSync(local)) return local;

  // Bun.resolveSync follows package exports: `"./styles.css"` in
  // renderer/web's package.json resolves to the workspace file in the
  // monorepo or the node_modules file in an installed app. Bun already
  // returns an absolute filesystem path, so `fileURLToPath` is unnecessary.
  if (!hasBun) {
    // Node-based unit tests reach this branch. Without Bun, package-export
    // resolution and a real Tailwind pipeline are unavailable, so skip
    // silently rather than reporting an error.
    return undefined;
  }
  try {
    const resolved = Bun.resolveSync("@cosmicdrift/kumiko-renderer/web/styles.css", process.cwd());
    if (!canResolveTailwindStylesheet(resolved, { bun: Bun, cwd: process.cwd() })) {
      return undefined;
    }
    return resolved;
  } catch (err) {
    logError(
      "[kumiko-server] couldn't auto-resolve @cosmicdrift/kumiko-renderer/web/styles.css — " +
        "pass `stylesheet: <path>` or `stylesheet: false` explicitly.",
      err,
    );
    return undefined;
  }
}

// The E2E template can only reach an app's own server entry through its env,
// so the env has to count whenever the option is left undefined.
//
// @internal — exported for unit tests only, not re-exported from the index.
export function resolveStylesheetWatch(
  options: Pick<CreateKumikoServerOptions, "stylesheetWatch">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (options.stylesheetWatch !== undefined) return options.stylesheetWatch;
  return env[STYLESHEET_WATCH_ENV] !== "0";
}

// Non-fatal by design (returns undefined): if the CLI can't be resolved or
// the initial build fails (flaky network, missing dependency), the server
// boots without CSS instead of dying.
async function startTailwindPipeline(
  entryCss: string,
  { watch }: { readonly watch: boolean },
): Promise<{ outPath: string; kill: () => void } | undefined> {
  const bunResolver = hasBun ? Bun : undefined;
  const cliPath = resolveTailwindCli({ bun: bunResolver, cwd: process.cwd() });
  if (cliPath === undefined) {
    logError(
      "[kumiko-server] @tailwindcss/cli nicht auflösbar — booting ohne CSS-Pipeline. " +
        "`bun install` und Restart, um Styles zu aktivieren.",
    );
    return undefined;
  }
  const outDir = mkdtempSync(join(tmpdir(), "kumiko-tw-"));
  const outPath = join(outDir, "styles.css");
  logInfo(
    watch
      ? `[kumiko-server] tailwind watcher → ${outPath}`
      : `[kumiko-server] tailwind one-shot build → ${outPath}`,
  );
  const bunPath = process.argv[0] ?? "bun";
  // Wait for the initial build so the first /styles.css request does not
  // return 404. Then run the watcher in the background with unref();
  // otherwise it could remain as an orphan after the parent crashes.
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const child = spawn(bunPath, ["run", cliPath, "-i", entryCss, "-o", outPath], {
        stdio: "inherit",
      });
      child.on("exit", (code) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`tailwind one-shot-build exit ${code}`));
      });
      child.on("error", rejectPromise);
    });
  } catch (err) {
    logError("[kumiko-server] tailwind one-shot-build fehlgeschlagen — booting ohne CSS:", err);
    return undefined;
  }
  if (!watch) {
    return { outPath, kill: () => {} };
  }
  const watcher = spawn(bunPath, ["run", cliPath, "-i", entryCss, "-o", outPath, "--watch"], {
    stdio: "inherit",
  });
  watcher.unref();
  return {
    outPath,
    kill: () => {
      try {
        watcher.kill("SIGTERM");
      } catch {
        // Already stopped or never started; no further action is needed.
      }
    },
  };
}

/** @internal — normalized client-entry form shared by single-entry
 *  (`clientEntry`) and multi-entry (`clientEntries`) modes. */
type NormalizedEntry = {
  readonly name: string;
  readonly sourceFile: string;
  readonly htmlPath: string | undefined;
};

/** URL path used to serve an entry: `"client"` → `/client.js`
 *  (the single-entry default), otherwise `/client-<name>.js`. Keeping
 *  this in one place ensures routing and logging use the same convention. */
function assetPathFor(entryName: string): string {
  return entryName === "client" ? "/client.js" : `/client-${entryName}.js`;
}

function normalizeEntries(options: CreateKumikoServerOptions): readonly NormalizedEntry[] {
  if (options.clientEntries !== undefined && options.clientEntry !== undefined) {
    throw new Error(
      "[kumiko-server] clientEntry und clientEntries sind mutually exclusive — wähle eins",
    );
  }
  if (options.clientEntries !== undefined && options.clientEntries.length > 0) {
    if (options.hostDispatch === undefined) {
      throw new Error(
        "[kumiko-server] clientEntries braucht hostDispatch — sonst weiß der Server nicht welches Template er liefern soll",
      );
    }
    return options.clientEntries.map((e) => ({
      name: e.name,
      sourceFile: resolve(e.sourceFile),
      htmlPath: e.htmlPath,
    }));
  }
  if (options.clientEntry !== undefined) {
    return [{ name: "client", sourceFile: resolve(options.clientEntry), htmlPath: undefined }];
  }
  return [];
}

export async function createKumikoServer(
  options: CreateKumikoServerOptions,
): Promise<KumikoServerHandle> {
  const port = options.port ?? Number(process.env["PORT"] ?? 4173);

  // --- client bundles (single-entry or multi-entry through the same map) ---
  const entries = normalizeEntries(options);
  const buildBundle = options._buildBundle ?? buildClient;
  const clientBundles = new Map<string, ClientBundle>();
  for (const e of entries) {
    const bundle = await buildBundle(e.sourceFile);
    clientBundles.set(e.name, bundle);
    logInfo(
      `[kumiko-server] client bundle ${e.name}: ${bundle.js.length.toLocaleString()} bytes` +
        (bundle.map ? ` (+ ${bundle.map.length.toLocaleString()} bytes sourcemap)` : ""),
    );
  }

  // --- Tailwind stylesheet (optional) ---
  // The Tailwind CLI writes to a temp file that every /styles.css request
  // reads fresh: no in-memory signalling needed, and the browser only
  // reloads after a bundle rebuild anyway.
  //
  // Without an explicit `stylesheet`, the default resolves through the
  // package exports of `@cosmicdrift/kumiko-renderer/web`, which works both
  // for a workspace link and for an installed app (node_modules).
  let stylesheetPath: string | undefined;
  let killTailwind: (() => void) | undefined;
  const resolvedStylesheet = resolveStylesheet(options);
  if (resolvedStylesheet !== undefined) {
    const handle = await startTailwindPipeline(resolvedStylesheet, {
      watch: resolveStylesheetWatch(options),
    });
    if (handle !== undefined) {
      stylesheetPath = handle.outPath;
      killTailwind = handle.kill;
    }
  }

  // --- HTML templates ---
  // Single-entry uses one template (`htmlPath` or DEFAULT_HTML).
  // Multi-entry uses one per entry (`entry.htmlPath ?? options.htmlPath
  // ?? DEFAULT_HTML`); hostDispatch selects it per request.
  const defaultTemplate =
    options.htmlPath !== undefined
      ? await readFile(resolve(options.htmlPath), "utf-8")
      : DEFAULT_HTML;
  const htmlTemplates = new Map<string, string>();
  for (const e of entries) {
    htmlTemplates.set(
      e.name,
      e.htmlPath !== undefined ? await readFile(resolve(e.htmlPath), "utf-8") : defaultTemplate,
    );
  }

  // --- Kumiko stack ---
  // KUMIKO_DEV_DB_NAME switches the underlying testDb from ephemeral
  // (fresh kumiko_test_<random>, dropped on cleanup) to persistent
  // (reuses the named DB across restarts). The var is framework-scoped
  // on purpose — every dev-server pattern benefits from the same
  // toggle, not just one sample.
  const devDbName = process.env["KUMIKO_DEV_DB_NAME"];
  const persistentDb = isPersistentDevDb(process.env);

  // Redis is shared across boots AND across apps (unlike the per-boot test
  // DB, which is ephemeral or persistent per KUMIKO_DEV_DB_NAME), so every
  // boot needs its own queue-name prefix — otherwise two dev/e2e servers
  // running in parallel drain each other's queues ("Unknown job: ..."). A
  // persistent DB implies a stable prefix so jobs survive a restart; an
  // ephemeral DB gets a fresh prefix per boot, matching the fresh DB.
  const jobQueueNamePrefix = persistentDb
    ? `kumiko-dev-${devDbName}`
    : `kumiko-dev-${crypto.randomUUID()}`;

  logInfo(
    `[kumiko-server] booting Kumiko stack${
      persistentDb ? ` — persistent DB "${devDbName}"` : " — ephemeral test DB"
    }…`,
  );
  const stack = await setupTestStack({
    features: options.features,
    ...(persistentDb && { dbName: devDbName, persistentDb: true }),
    ...(options.auth !== undefined && { authConfig: options.auth }),
    ...(options.extraContext !== undefined && { extraContext: options.extraContext }),
    ...(options.anonymousAccess !== undefined && { anonymousAccess: options.anonymousAccess }),
    enrichAnonymousAccess: (base, deps) => resolveAnonymousAccessFromRegistry(base, deps),
    ...(options.files !== undefined && { files: options.files }),
    ...(options.effectiveFeatures !== undefined && {
      effectiveFeatures: options.effectiveFeatures,
    }),
    ...(options.extraRoutes !== undefined && { extraRoutes: options.extraRoutes }),
    ...(options.trustedProxyHops !== undefined && { trustedProxyHops: options.trustedProxyHops }),
    ...(options.errorDocs && { errorDocs: options.errorDocs }),
    // jobs.consumerLane unset = enqueuer-only; startDevJobRunners below is
    // the sole consumer/cron-scheduler per lane, so runOnBoot/cron jobs
    // don't double-fire. queueNamePrefix keeps this boot's queues isolated
    // from every other dev/e2e server sharing the same Redis.
    jobs: { queueNamePrefix: jobQueueNamePrefix },
  });
  await createEventsTable(stack.db);
  await pushEntityProjectionTables(stack, stack.registry);

  // `extraRoutes` is already mounted — setupTestStack's buildServer() call
  // wired it above, before this function ever runs. `wire` is the
  // remaining escape-hatch for app-wired co-running components that need
  // the system-write dispatcher but don't declare a route.
  if (options.wire !== undefined) {
    await options.wire({
      db: stack.db,
      // The raw ioredis client, not the TestRedis wrapper, matching runProdApp
      // so application code sees the same interface in development and production.
      redis: stack.redis.redis,
      registry: stack.registry,
      metricsFor: createMetricsForFactory(stack.observability.meter),
      dispatchSystemWrite: makeDispatchSystemWrite(stack.dispatcher),
      dispatchSystemQuery: makeDispatchSystemQuery(stack.dispatcher),
    });
  }

  // Hook for caller-specific tables and seeding. It runs after entity tables
  // are created, so the hook can use `stack.db` / `stack.dispatcher`, and
  // before the server starts, so the first request sees initialized state. Idempotence is the caller's responsibility because
  // persistent-DB mode runs the hook on every boot.
  if (options.onAfterSetup !== undefined) {
    await options.onAfterSetup(stack);
  }

  // setupTestStack configures but does not start the event dispatcher so
  // integration tests can drain it deterministically with runOnce(). The
  // dev server starts polling so SSE broadcasts reach connected clients;
  // otherwise events remain in the events table.
  if (stack.eventDispatcher) {
    await stack.eventDispatcher.start();
  }

  const redisUrl = `redis://${stack.redis.redis.options.host}:${stack.redis.redis.options.port}/${stack.redis.redis.options.db}`;
  const devJobRunners = await startDevJobRunners({
    registry: stack.registry,
    db: stack.db,
    // The stack's own AppContext, not a `{ db, registry }` literal: these
    // runners consume the lanes, and a job reaching for ctx.files /
    // ctx.notify / ctx.config would otherwise die here while the very same
    // handler works on the request path.
    context: stack.context,
    redisUrl,
    // Same dispatcher the request path writes through — without this,
    // ctx.write/ctx.writeAs/ctx.queryAs inside a dev-run job throw on their
    // first call.
    dispatcher: stack.dispatcher,
    // Same isolation reasoning as setupTestStack's jobs.queueNamePrefix
    // above — both must use the same prefix so enqueuer and consumer agree
    // on queue names.
    queueNamePrefix: jobQueueNamePrefix,
  });

  // Dev user = TestUsers.admin. Demo features are openToAll, but the
  // auth middleware still requires a valid JWT. When `options.auth` is set,
  // the client performs login instead.
  const autoMintJwt = options.auth === undefined;
  const devUser = TestUsers.admin;

  // Build once at boot purely to surface authoring warnings (settings-hub
  // placement etc.) at the same point prod would — clients fetch the actual
  // schema themselves from GET /api/schema, so the result itself is
  // discarded here.
  buildAppSchema(stack.registry, {
    authoringWarnings: true,
    searchAdapterMissing: !stack.context.searchAdapter,
  });

  // --- SSE reload ---
  // bootId identifies this server process instance. It is sent on connect;
  // the browser remembers the first value and refreshes when a reconnect
  // receives a different one, indicating that the server restarted and
  // the old bundle is stale. See RELOAD_SNIPPET above.
  const bootId = String(Date.now());
  const reloadClients = new Set<ReloadClient>();
  // JSON-encoded so a filename can never break the SSE framing.
  const broadcastReload = (changedFile: string): void => {
    const payload = `event: reload\ndata: ${JSON.stringify(changedFile)}\n\n`;
    for (const client of reloadClients) {
      if (client.closed) continue;
      try {
        client.controller.enqueue(client.encoder.encode(payload));
      } catch {
        client.closed = true;
      }
    }
  };

  // Build a fresh HTML response. In auto-mint mode (no auth config) we
  // pack a valid JWT + CSRF cookie right in — deep-links work immediately
  // without login (and that auth cookie is what a client-side fetch to
  // GET /api/schema authenticates with). In auth mode we serve the bare
  // HTML; the client then goes through /auth/login and gets its cookies
  // from there.
  //
  // entryName is decided by the caller (handleFetch) after evaluating
  // hostDispatch. Without hostDispatch it's always "client" (single-entry
  // default).
  //
  // Anonymous-role systemQuery, shared by resolvePageHead and hostDispatch —
  // mirrors runProdApp's HostDispatchFn deps so dev/prod stay symmetric.
  // Own resolver mirroring the same effective hops as setupTestStack's
  // internal buildServer — this path runs for
  // page-head/hostDispatch resolution, ahead of requestIdMiddleware's
  // /api/* mount, so it can't reuse that instance. Two independent
  // warn-once flags in dev is an accepted, low-risk gap (dev normally
  // runs unproxied — see CreateKumikoServerOptions.trustedProxyHops).
  const pageHeadClientIpResolver = createClientIpResolver(
    options.trustedProxyHops ?? 0,
    "createKumikoServer(pageHead)",
  );
  const buildDevSystemQuery = (req: Request, socketAddress?: string): PageHeadSystemQuery =>
    buildRequestBoundSystemQuery({
      req,
      dispatcher: stack.dispatcher,
      resolver: pageHeadClientIpResolver,
      socketAddress,
    });

  // resolvePageHead goes through the same headless resolveAndInjectPageHead
  // that runProdApp uses, so dev and e2e exercise the one timeout and
  // fallback path instead of a second copy of it.
  const htmlResponse = async (
    entryName: string,
    req: Request,
    socketAddress?: string,
    status = 200,
  ): Promise<Response> => {
    const template = htmlTemplates.get(entryName) ?? defaultTemplate;
    const headers = new Headers();
    headers.set("Content-Type", "text/html; charset=utf-8");
    if (autoMintJwt) {
      const jwt = await stack.jwt.sign(devUser);
      const csrf = generateToken();
      headers.append("Set-Cookie", `${AUTH_COOKIE}=${jwt}; Path=/; HttpOnly; SameSite=Lax`);
      headers.append("Set-Cookie", `${CSRF_COOKIE}=${csrf}; Path=/; SameSite=Lax`);
    }
    let html = injectReload(template);
    if (stylesheetPath !== undefined) html = injectStylesheet(html);
    if (options.resolvePageHead !== undefined) {
      const url = new URL(req.url);
      const host = req.headers.get("host") ?? url.host;
      html = await resolveAndInjectPageHead(html, options.resolvePageHead, {
        path: url.pathname,
        host,
        preferredLocales: rankPreferredLocales({
          queryLang: url.searchParams.get("lang"),
          acceptLanguage: req.headers.get("accept-language"),
        }),
        systemQuery: buildDevSystemQuery(req, socketAddress),
        requestSignal: req.signal,
      });
    }
    return new Response(html, { status, headers });
  };

  // Raw file serve, no bundle injection — mirrors prod's `{ kind: "html", file }`.
  const staticHtmlResponse = async (file: string, status: number): Promise<Response> => {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch (error) {
      if (errorCodeOf(error) !== "ENOENT") throw error;
      return new Response(`hostDispatch: file not found: ${file}`, { status: 500 });
    }
    return new Response(content, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  // --- Fetch handler (runtime-neutral) ---
  // Bundle path lookup: each entry is served at
  //   GET /client[-name].js      → JS bundle
  //   GET /client[-name].js.map  → sourcemap
  // assetPathFor() is the single source of truth for the URL form.
  const bundleByAssetPath = new Map<string, string>();
  for (const e of entries) bundleByAssetPath.set(assetPathFor(e.name), e.name);

  // App-root convention (same as expandWatchPatterns/resolveStylesheet above):
  // process.cwd() is the app workspace, so public/ is its static asset dir.
  // Symlink-resolved once: servePublicFile compares realpath()s against it, so
  // a symlinked public/ would otherwise 404 every file.
  const lexicalPublicDir = resolve(process.cwd(), "public");
  const publicDir = existsSync(lexicalPublicDir)
    ? realpathSync(lexicalPublicDir)
    : lexicalPublicDir;
  // The app's cwd first, this package's own location as fallback (the cwd may
  // not have renderer/web installed, e.g. a fixture dir).
  const rendererWebFontsDir = resolveRendererWebFontsDir([process.cwd(), import.meta.dir]);

  const routeFetch = async (req: Request, socketAddress?: string): Promise<Response> => {
    const url = new URL(req.url);

    // Specific routes first — assets, reload-SSE, API.
    if (req.method === "GET") {
      const bundleName = bundleByAssetPath.get(url.pathname);
      if (bundleName !== undefined) {
        const bundle = clientBundles.get(bundleName);
        if (bundle === undefined) return new Response("no bundle", { status: 404 });
        return new Response(bundle.js, {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }
      // Looked up in the live bundles instead of a separate index, which a
      // hot-reload rebuild would leave stale.
      for (const bundle of clientBundles.values()) {
        const chunk = bundle.chunks?.get(url.pathname);
        if (chunk !== undefined) {
          return new Response(chunk, {
            headers: { "Content-Type": "application/javascript; charset=utf-8" },
          });
        }
      }

      // .js.map variant: perform the same lookup after removing /.map.
      if (url.pathname.endsWith(".js.map")) {
        const jsPath = url.pathname.slice(0, -".map".length);
        const mapName = bundleByAssetPath.get(jsPath);
        if (mapName !== undefined) {
          const bundle = clientBundles.get(mapName);
          if (bundle === undefined || !bundle.map) {
            return new Response("no map", { status: 404 });
          }
          return new Response(bundle.map, {
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      }
    }

    if (url.pathname.startsWith(RENDERER_WEB_FONTS_URL_PREFIX) && req.method === "GET") {
      const fontFile = url.pathname.slice(RENDERER_WEB_FONTS_URL_PREFIX.length);
      // The allowlist pattern excludes "/", "." segments and encoded traversal.
      if (rendererWebFontsDir === undefined || !RENDERER_WEB_FONT_FILE_PATTERN.test(fontFile)) {
        return new Response("not found", { status: 404 });
      }
      try {
        const bytes = await readFile(join(rendererWebFontsDir, fontFile));
        // @cast-boundary Buffer satisfies BodyInit at runtime, bun-types just doesn't say so.
        return new Response(bytes as unknown as BodyInit, {
          headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=86400" },
        });
      } catch (err) {
        if (errorCodeOf(err) === "ENOENT") {
          return new Response("not found", { status: 404 });
        }
        throw err;
      }
    }

    if (url.pathname === "/styles.css" && req.method === "GET") {
      if (stylesheetPath === undefined) return new Response("no stylesheet", { status: 404 });
      const css = await readFile(stylesheetPath, "utf-8");
      return new Response(css, {
        headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }

    if (url.pathname === "/_reload" && req.method === "GET") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const entry: ReloadClient = { controller, encoder, closed: false };
          reloadClients.add(entry);
          controller.enqueue(encoder.encode(": connected\n\n"));
          // boot event: the browser snippet compares this with the first
          // bootId. A different value after reconnect means the server
          // restarted, so location.reload() is called.
          controller.enqueue(encoder.encode(`event: boot\ndata: ${bootId}\n\n`));
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

    // SPA catch-all: GET or HEAD requests to non-API, non-asset paths return
    // the HTML shell so the client-side router can mount the screen for
    // location.pathname. Paths containing a dot are left to the stack's
    // 404 handling.
    //
    // Backend routes outside /api, currently including /sse, must be
    // excluded so the catch-all does not shadow Hono routes.
    //
    // Feature routes declared with r.httpRoute can also be outside /api.
    // Try stack.app.fetch first so a matching Hono route wins; only a Hono
    // 404 proceeds to the SPA fallback, matching production behavior.
    if (
      // Include HEAD: runProdApp falls back to the SPA for both GET and HEAD;
      // omitting it would make development return 404 where production returns 200.
      isRoutableGetOrHead(req, url.pathname) &&
      !url.pathname.includes(".")
    ) {
      const honoTry = await tryHonoFirst(stack.app, req, socketAddress);
      if (honoTry.matched) {
        return honoTry.response;
      }
      // Discriminated dispatch mirrors production. Without hostDispatch, use
      // the single-entry default ("client").
      if (options.hostDispatch !== undefined) {
        const dispatch = await options.hostDispatch(req, {
          systemQuery: buildDevSystemQuery(req, socketAddress),
          cspScriptHashes: [],
        });
        if (dispatch.kind === "redirect") {
          return new Response(null, {
            status: dispatch.status ?? 302,
            headers: { Location: dispatch.to },
          });
        }
        if (dispatch.kind === "not-found") {
          if (dispatch.file !== undefined) return staticHtmlResponse(dispatch.file, 404);
          if (dispatch.entryName !== undefined) {
            return htmlResponse(dispatch.entryName, req, socketAddress, 404);
          }
          return new Response("Not Found", { status: 404 });
        }
        if (dispatch.kind === "static-html") {
          return staticHtmlResponse(dispatch.file, 200);
        }
        return htmlResponse(dispatch.entryName, req, socketAddress);
      }
      return htmlResponse("client", req, socketAddress);
    }

    // Static assets under public/ — see tryServePublicAsset's own comment
    // for the Hono → file → router-miss ordering.
    const staticAsset = await tryServePublicAsset(
      req,
      url.pathname,
      stack.app,
      publicDir,
      socketAddress,
    );
    if (staticAsset !== undefined) return staticAsset;

    // Bypasses tryHonoFirst entirely (API paths, /sse, non-GET/HEAD), so the
    // router-miss marker must be stripped here too — otherwise an unmatched
    // path would leak it straight to the client (see try-hono-first.ts's
    // header-hygiene note).
    return stripNoRouteMatchHeader(await stack.app.fetch(req, socketAddress));
  };
  const handleFetch = options.wrapFetch ? options.wrapFetch(routeFetch) : routeFetch;

  // --- HTTP server (Bun only) ---
  // Under Node/vitest, skip Bun.serve; the handle's .fetch() is the test
  // surface. Under Bun, Bun.serve wires the listener.
  // Bun.serve options come from buildBunServeOptions (run-prod-app.ts) so
  // development and production share the same SSE-relevant defaults
  // (idleTimeout: 0); run-prod-app-spec.test.ts pins that.
  const server = hasBun
    ? Bun.serve(
        buildBunServeOptions(port, handleFetch, resolveDerivedMaxRequestBodySize(stack.registry), {
          upgradeFetch: async (req, env) =>
            stripNoRouteMatchHeader(await stack.app.fetch(req, env)),
        }),
      )
    : undefined;

  // --- file watcher → rebundle + reload, or process restart for schema changes ---
  // Heuristic: files in `web/` or `__tests__/` are client-side or test-only,
  // so hot reload is sufficient. Other files are server-side; because Bun
  // caches module imports, a schema change in feature.ts requires a process
  // restart. Exit with code 75 (EX_TEMPFAIL) so the `kumiko-dev` wrapper
  // can respawn the process.
  //
  // stop() aborts watcherAbort, which ends fs.watch's async iteration. This
  // prevents a watcher from surviving test teardown and classifying an
  // rmSync(tmpdir) as "restart needed".
  const watcherAbort = new AbortController();
  if (entries.length > 0) {
    // Watch directories: all entry directories (deduplicated) plus the explicit
    // watchDirs. In multi-entry setups, entries often share a src/ directory
    // (`src/client-admin.tsx` + `src/client-public.tsx`), so the Set keeps
    // one watcher per directory.
    const entryDirs = new Set<string>();
    for (const e of entries) entryDirs.add(resolve(e.sourceFile, ".."));
    const entrySourceFiles = new Set(entries.map((e) => resolve(e.sourceFile)));
    const dirs = [...entryDirs, ...expandWatchPatterns(options.watchDirs ?? [])];
    for (const dir of dirs) {
      void watchDir(
        dir,
        async (filename) => {
          const action = classifyWatchedChange(dir, filename, entrySourceFiles);
          // skip: file change classified as ignore (test/css/json), nothing to rebuild
          if (action === "ignore") return;
          if (action === "restart") {
            logInfo(
              `[kumiko-server] schema change in ${filename} — restarting (Bun caches imports, hot-reload reicht hier nicht). ` +
                "The kumiko-dev wrapper (package.json's `dev` script) respawns automatically " +
                "and re-syncs new r.entity() columns on the new boot; running this entry " +
                "directly (not via kumiko-dev) exits here without restarting.",
            );
            await stop();
            process.exit(75);
          }
          try {
            // Rebuild all entries—even when only one file changes, because we do not
            // know which entries import it. With shared code, an edit triggers
            // both bundles; this is intentional.
            for (const e of entries) {
              const rebuilt = await buildBundle(e.sourceFile);
              clientBundles.set(e.name, rebuilt);
            }
            logInfo(`[kumiko-server] rebuilt on ${filename}, broadcasting reload`);
            broadcastReload(filename);
          } catch {
            // buildClient already logged the failure; keep serving the
            // last good bundle until the next successful rebuild.
          }
        },
        watcherAbort.signal,
        options._watchDirectory ?? watch,
      );
    }
  }

  // The per-boot prefix is never reused, so its BullMQ keys (queues,
  // repeatables, delayed jobs) would pile up in the shared Redis forever.
  // A prefix-less duplicate: SCAN returns full key names, which the stack
  // client's keyPrefix would otherwise prepend a second time.
  // Takes the connection as a parameter: it must be opened before
  // stack.cleanup() closes the stack client, yet used only after it, because
  // closing the stack's enqueuer queues re-writes their `meta` keys.
  const deleteEphemeralJobQueues = async (raw: typeof stack.redis.redis): Promise<void> => {
    try {
      const keys: string[] = [];
      for await (const batch of raw.scanStream({
        match: `bull:${jobQueueNamePrefix}-*`,
        count: 500,
      })) {
        keys.push(...batch);
      }
      if (keys.length > 0) await raw.del(...keys);
    } finally {
      raw.disconnect();
    }
  };

  const stop = async (): Promise<void> => {
    // Stop the watcher first so no onChange callback runs during teardown;
    // otherwise removing the temporary directory could trigger process.exit(75).
    watcherAbort.abort();
    if (killTailwind) killTailwind();
    if (server !== undefined) {
      server.stop(true);
    }
    if (stack.eventDispatcher) {
      await stack.eventDispatcher.stop();
    }
    await devJobRunners.stop();
    const rawRedis = persistentDb ? undefined : stack.redis.redis.duplicate({ keyPrefix: "" });
    await stack.cleanup();
    if (rawRedis) await deleteEphemeralJobQueues(rawRedis);
  };

  // --- graceful shutdown ---
  // Signal handlers run on Ctrl-C / kill. Without them, repeated dev
  // restarts leak Postgres pools, leave the Tailwind watcher as an orphan,
  // and leave temporary clients behind in persistent mode.
  // uncaughtException and unhandledRejection previously left the Tailwind
  // watcher running in the background; clean it up before exiting nonzero.
  const installHandlers = options.installSignalHandlers ?? true;
  if (installHandlers) {
    for (const sig of ["SIGINT", "SIGTERM"] as const) {
      process.on(sig, async () => {
        logInfo(`[kumiko-server] ${sig} — cleaning up…`);
        await stop();
        process.exit(0);
      });
    }
    process.on("uncaughtException", async (err) => {
      logError("[kumiko-server] uncaughtException — cleaning up…", err);
      try {
        await stop();
      } finally {
        process.exit(1);
      }
    });
    process.on("unhandledRejection", async (err) => {
      logError("[kumiko-server] unhandledRejection — cleaning up…", err);
      try {
        await stop();
      } finally {
        process.exit(1);
      }
    });
  }

  if (server !== undefined) {
    logInfo(
      `[kumiko-server] listening on http://localhost:${port}` +
        (entries.length > 0
          ? ` (hot reload on ${entries.length === 1 ? "client entry" : `${entries.length} entries`})`
          : ""),
    );
  }

  return { fetch: handleFetch, server, stack, stop, jobQueueNamePrefix };
}
