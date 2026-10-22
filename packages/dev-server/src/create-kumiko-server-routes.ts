/// <reference types="bun-types" preserve="true" />
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  RENDERER_WEB_FONT_FILE_PATTERN,
  RENDERER_WEB_FONTS_URL_PREFIX,
  resolveRendererWebFontsDir,
} from "@cosmicdrift/kumiko-server-runtime/renderer-web-fonts";
import {
  type HonoLikeApp,
  stripNoRouteMatchHeader,
  tryHonoFirst,
} from "@cosmicdrift/kumiko-server-runtime/try-hono-first";
import type { TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import type {
  CreateKumikoServerOptions,
  DevHostDispatch,
  DevHostDispatchResult,
} from "./create-kumiko-server.ts";
import {
  type ClientBundle,
  indexBundlesByAssetPath,
  type NormalizedEntry,
} from "./create-kumiko-server-client-bundles.ts";
import {
  createDevSystemQueryBuilder,
  type DevHtmlDeps,
  type DevHtmlTemplates,
  respondWithHtmlShell,
  respondWithStaticHtmlFile,
} from "./create-kumiko-server-html.ts";
import {
  isRoutableGetOrHead,
  resolveDevPublicDir,
  servePublicFile,
} from "./create-kumiko-server-public-files.ts";
import { type DevReloadHub, openReloadStream } from "./create-kumiko-server-reload.ts";

export type DevFetchHandler = (req: Request, socketAddress?: string) => Promise<Response>;

type DevRouteDeps = {
  readonly app: HonoLikeApp;
  // The live map: a hot-reload rebuild replaces its entries in place.
  readonly clientBundles: ReadonlyMap<string, ClientBundle>;
  readonly bundleByAssetPath: ReadonlyMap<string, string>;
  readonly rendererWebFontsDir: string | undefined;
  readonly publicDir: string;
  readonly reloadHub: DevReloadHub;
  readonly hostDispatch: DevHostDispatch | undefined;
  readonly html: DevHtmlDeps;
};

type DevRouteRequest = {
  readonly req: Request;
  readonly url: URL;
  readonly socketAddress: string | undefined;
};

// undefined hands the request on to the next route.
type DevRoute = (
  request: DevRouteRequest,
  deps: DevRouteDeps,
) => Response | undefined | Promise<Response | undefined>;

const JAVASCRIPT_HEADERS = { "Content-Type": "application/javascript; charset=utf-8" };

function serveClientBundle({ req, url }: DevRouteRequest, deps: DevRouteDeps) {
  if (req.method !== "GET") return undefined;
  const bundleName = deps.bundleByAssetPath.get(url.pathname);
  if (bundleName === undefined) return undefined;
  const bundle = deps.clientBundles.get(bundleName);
  if (bundle === undefined) return new Response("no bundle", { status: 404 });
  return new Response(bundle.js, { headers: JAVASCRIPT_HEADERS });
}

// Looked up in the live bundles instead of a separate index, which a
// hot-reload rebuild would leave stale.
function serveBundleChunk({ req, url }: DevRouteRequest, deps: DevRouteDeps) {
  if (req.method !== "GET") return undefined;
  for (const bundle of deps.clientBundles.values()) {
    const chunk = bundle.chunks?.get(url.pathname);
    if (chunk !== undefined) return new Response(chunk, { headers: JAVASCRIPT_HEADERS });
  }
  return undefined;
}

function serveBundleSourceMap({ req, url }: DevRouteRequest, deps: DevRouteDeps) {
  if (req.method !== "GET" || !url.pathname.endsWith(".js.map")) return undefined;
  const mapName = deps.bundleByAssetPath.get(url.pathname.slice(0, -".map".length));
  if (mapName === undefined) return undefined;
  const bundle = deps.clientBundles.get(mapName);
  if (bundle === undefined || !bundle.map) return new Response("no map", { status: 404 });
  return new Response(bundle.map, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function serveRendererWebFont({ req, url }: DevRouteRequest, deps: DevRouteDeps) {
  if (!url.pathname.startsWith(RENDERER_WEB_FONTS_URL_PREFIX) || req.method !== "GET") {
    return undefined;
  }
  const fontFile = url.pathname.slice(RENDERER_WEB_FONTS_URL_PREFIX.length);
  // The allowlist pattern excludes "/", "." segments and encoded traversal.
  if (deps.rendererWebFontsDir === undefined || !RENDERER_WEB_FONT_FILE_PATTERN.test(fontFile)) {
    return new Response("not found", { status: 404 });
  }
  try {
    const bytes = await readFile(join(deps.rendererWebFontsDir, fontFile));
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

async function serveStylesheet({ req, url }: DevRouteRequest, deps: DevRouteDeps) {
  if (url.pathname !== "/styles.css" || req.method !== "GET") return undefined;
  const { stylesheetPath } = deps.html;
  if (stylesheetPath === undefined) return new Response("no stylesheet", { status: 404 });
  const css = await readFile(stylesheetPath, "utf-8");
  return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } });
}

function serveReloadStream({ req, url }: DevRouteRequest, deps: DevRouteDeps) {
  if (url.pathname !== "/_reload" || req.method !== "GET") return undefined;
  return openReloadStream(deps.reloadHub);
}

function respondToNotFoundDispatch(
  dispatch: Extract<DevHostDispatchResult, { readonly kind: "not-found" }>,
  { req, socketAddress }: DevRouteRequest,
  html: DevHtmlDeps,
): Response | Promise<Response> {
  if (dispatch.file !== undefined) return respondWithStaticHtmlFile(dispatch.file, 404);
  if (dispatch.entryName !== undefined) {
    return respondWithHtmlShell(html, dispatch.entryName, req, socketAddress, 404);
  }
  return new Response("Not Found", { status: 404 });
}

// Discriminated dispatch mirrors production; anything that is not a
// redirect, not-found or static-html result serves its entry's shell.
function respondToHostDispatch(
  dispatch: DevHostDispatchResult,
  request: DevRouteRequest,
  html: DevHtmlDeps,
): Response | Promise<Response> {
  switch (dispatch.kind) {
    case "redirect":
      return new Response(null, {
        status: dispatch.status ?? 302,
        headers: { Location: dispatch.to },
      });
    case "not-found":
      return respondToNotFoundDispatch(dispatch, request, html);
    case "static-html":
      return respondWithStaticHtmlFile(dispatch.file, 200);
    default:
      return respondWithHtmlShell(html, dispatch.entryName, request.req, request.socketAddress);
  }
}

// SPA catch-all: GET or HEAD requests to non-API, non-asset paths return
// the HTML shell so the client-side router can mount the screen for
// location.pathname. Paths containing a dot are left to the public/ lookup.
//
// HEAD is included because runProdApp falls back to the SPA for both GET and
// HEAD. Backend routes outside /api (currently /sse) are excluded, and an
// r.httpRoute outside /api is tried first, so only a Hono router miss falls
// back to the shell, matching production.
async function serveSpaShell(request: DevRouteRequest, deps: DevRouteDeps) {
  const { req, url, socketAddress } = request;
  if (!isRoutableGetOrHead(req, url.pathname) || url.pathname.includes(".")) return undefined;
  const honoTry = await tryHonoFirst(deps.app, req, socketAddress);
  if (honoTry.matched) {
    return honoTry.response;
  }
  if (deps.hostDispatch === undefined) {
    return respondWithHtmlShell(deps.html, "client", req, socketAddress);
  }
  const dispatch = await deps.hostDispatch(req, {
    systemQuery: deps.html.buildSystemQuery(req, socketAddress),
    cspScriptHashes: [],
  });
  return respondToHostDispatch(dispatch, request, deps.html);
}

// Static assets under public/ — prod serves these via buildStaticFallback's
// disk lookup (run-prod-app-static-files.ts). Hono still goes first (an
// r.httpRoute could itself own a dotted path), then the file on disk, then
// the router-miss 404, mirroring the SPA branch.
async function servePublicAsset({ req, url, socketAddress }: DevRouteRequest, deps: DevRouteDeps) {
  if (!isRoutableGetOrHead(req, url.pathname) || !url.pathname.includes(".")) return undefined;
  const honoTry = await tryHonoFirst(deps.app, req, socketAddress);
  if (honoTry.matched) {
    return honoTry.response;
  }
  const file = await servePublicFile(url.pathname, deps.publicDir);
  if (file !== undefined) {
    // @cast-boundary Buffer satisfies BodyInit at runtime, bun-types
    // just doesn't say so — same cast run-prod-app-static-files.ts uses.
    return new Response(file.bytes as unknown as BodyInit, {
      headers: { "Content-Type": file.mime },
    });
  }
  return honoTry.response;
}

// Specific routes first (assets, reload SSE), then the SPA shell and
// public/ files; whatever is left goes to the Kumiko stack.
const DEV_ROUTES: readonly DevRoute[] = [
  serveClientBundle,
  serveBundleChunk,
  serveBundleSourceMap,
  serveRendererWebFont,
  serveStylesheet,
  serveReloadStream,
  serveSpaShell,
  servePublicAsset,
];

function createDevRouteFetch(deps: DevRouteDeps): DevFetchHandler {
  return async (req, socketAddress) => {
    const request: DevRouteRequest = { req, url: new URL(req.url), socketAddress };
    for (const route of DEV_ROUTES) {
      const response = await route(request, deps);
      if (response !== undefined) return response;
    }
    // Bypasses tryHonoFirst entirely (API paths, /sse, non-GET/HEAD), so the
    // router-miss marker must be stripped here too — otherwise an unmatched
    // path would leak it straight to the client (see try-hono-first.ts's
    // header-hygiene note).
    return stripNoRouteMatchHeader(await deps.app.fetch(req, socketAddress));
  };
}

export function createDevFetchHandler(input: {
  readonly options: CreateKumikoServerOptions;
  readonly stack: TestStack;
  readonly entries: readonly NormalizedEntry[];
  readonly clientBundles: ReadonlyMap<string, ClientBundle>;
  readonly templates: DevHtmlTemplates;
  readonly stylesheetPath: string | undefined;
  readonly reloadHub: DevReloadHub;
}): DevFetchHandler {
  const { options, stack } = input;
  const buildSystemQuery = createDevSystemQueryBuilder(stack.dispatcher, options.trustedProxyHops);
  const routeFetch = createDevRouteFetch({
    app: stack.app,
    clientBundles: input.clientBundles,
    bundleByAssetPath: indexBundlesByAssetPath(input.entries),
    publicDir: resolveDevPublicDir(),
    // The app's cwd first, this package's own location as fallback (the cwd
    // may not have renderer/web installed, e.g. a fixture dir).
    rendererWebFontsDir: resolveRendererWebFontsDir([process.cwd(), import.meta.dir]),
    reloadHub: input.reloadHub,
    hostDispatch: options.hostDispatch,
    html: {
      templates: input.templates,
      jwt: stack.jwt,
      autoMintJwt: options.auth === undefined,
      stylesheetPath: input.stylesheetPath,
      resolvePageHead: options.resolvePageHead,
      buildSystemQuery,
    },
  });
  return options.wrapFetch ? options.wrapFetch(routeFetch) : routeFetch;
}
