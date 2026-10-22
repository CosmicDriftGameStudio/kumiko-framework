import { join, resolve, sep } from "node:path";
import {
  type CachePolicy,
  type ClientIpResolver,
  cachedResponse,
  computeStrongEtag,
  computeWeakEtag,
  createClientIpResolver,
} from "@cosmicdrift/kumiko-framework/api";
import { rankPreferredLocales } from "@cosmicdrift/kumiko-framework/i18n";
import { resolveAndInjectPageHead } from "@cosmicdrift/kumiko-renderer/headless/apex";
import { errorCodeOf } from "@cosmicdrift/kumiko-types/type-guards";
import { ASSETS_DIR } from "./build-prod-bundle.ts";
import { BUNDLED_ASSETS_DIST_DIR } from "./bundled-assets.ts";
import { CSP_HASHES_FILE, parseCspHashes } from "./csp-hashes.ts";
import {
  buildRequestBoundSystemQuery,
  type QueryDispatcher,
} from "./request-bound-system-query.ts";
import type { HostDispatchFn, PageHeadResolver, PageHeadSystemQuery } from "./run-prod-app.ts";
import type { SecurityHeadersOption } from "./security-headers.ts";
import { stripNoRouteMatchHeader, tryHonoFirst } from "./try-hono-first.ts";

// Static-asset + SPA-fallback serving for runProdApp's HTTP handler. Split
// out of run-prod-app.ts — mechanical relocation, these
// functions are self-contained (no closure over runProdApp's local boot
// state), only params.

// Static fallback: try the Hono app first and serve a file from staticDir only
// when Hono returns 404, so /api/* stays on the dispatcher while HTML,
// JavaScript, CSS, and images come from disk.
//
// Cache-header strategy:
//   /assets/*               → public, max-age=31536000, immutable
//                             (build-generated hashed filenames are safe to cache)
//   /index.html             → no-cache, must-revalidate
//                             (the HTML shell must reload after deployment)
//   /manifest.json, /sw.js  → no-cache
//                             (update-detection mechanisms must stay fresh)
//   everything else         → no explicit header
//                             (browser default, including public/ files such as favicon)
//
// Use node:fs/promises instead of Bun.file so this path also runs in vitest+node
// integration tests; Bun.file is Bun-only. Full-buffer reads are acceptable because
// production static files are typically 1–200 KB; streaming would matter only above
// roughly 1 MB.
export async function readStaticFile(
  filePath: string,
): Promise<
  { readonly bytes: Uint8Array; readonly mime: string; readonly mtimeMs: number } | undefined
> {
  try {
    const { readFile, stat } = await import("node:fs/promises");
    const [bytes, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
    return { bytes, mime: mimeTypeFor(filePath), mtimeMs: fileStat.mtimeMs };
  } catch (err) {
    const code = errorCodeOf(err);
    // ENOENT: no such path. EISDIR: readFile() on a directory (e.g. GET
    // /assets where "assets" is a subfolder copied verbatim from public/).
    // ENOTDIR: a path segment that isn't a directory is used as one (e.g.
    // GET /index.html/x — "index.html" is a file, not a directory) — all
    // three mean "not a servable file", so fall through to the SPA
    // fallback instead of a 500.
    if (code === "ENOENT" || code === "EISDIR" || code === "ENOTDIR") return undefined;
    throw err;
  }
}

/** Hashes for the default CSP. Only an app that keeps the default CSP and serves a
 *  staticDir needs them; a missing or broken file leaves inline scripts blocked, so boot says so. */
export async function resolveCspScriptHashes(
  staticDir: string | undefined,
  securityHeaders: SecurityHeadersOption | undefined,
): Promise<readonly string[]> {
  if (staticDir === undefined || !usesDefaultCsp(securityHeaders)) return [];
  return readBuildScriptHashes(staticDir);
}

function usesDefaultCsp(securityHeaders: SecurityHeadersOption | undefined): boolean {
  if (securityHeaders === false) return false;
  const csp = securityHeaders?.csp;
  return csp !== false && typeof csp !== "string";
}

/** Hashes handed to hostDispatch: read from disk only when the default-CSP
 *  path above has not already done so. */
export async function resolveHostDispatchScriptHashes(
  staticDir: string,
  securityHeaders: SecurityHeadersOption | undefined,
  defaultCspHashes: readonly string[],
): Promise<readonly string[]> {
  return usesDefaultCsp(securityHeaders) ? defaultCspHashes : readBuildScriptHashes(staticDir);
}

export async function readBuildScriptHashes(staticDir: string): Promise<readonly string[]> {
  const file = await readStaticFile(join(staticDir, CSP_HASHES_FILE));
  const result = file ? parseCspHashes(new TextDecoder().decode(file.bytes)) : undefined;
  if (result?.kind === "found") return result.scriptSrc;
  const problem =
    result === undefined
      ? `${CSP_HASHES_FILE} not found in ${staticDir} (written by kumiko build)`
      : `${CSP_HASHES_FILE} is invalid: ${result.kind === "invalid" ? result.problem : ""}`;
  // biome-ignore lint/suspicious/noConsole: boot-time warn, no logger configured this early
  console.warn(
    `[runProdApp] ${problem}; the default CSP carries no inline-script hashes, so inline scripts in the served HTML are blocked. ` +
      "Rebuild with kumiko build, or set securityHeaders.csp.",
  );
  return [];
}

// Bundled assets are server-side inputs (readBundledAsset), never public URLs.
// Compared on the resolved path, not the URL prefix: "//kumiko-bundled-assets/x"
// or a case variant on a case-insensitive disk would slip past a prefix check.
function isInsideBundledAssetsDir(staticDir: string, filePath: string): boolean {
  const bundledDir = resolve(staticDir, BUNDLED_ASSETS_DIST_DIR).toLowerCase();
  const target = resolve(filePath).toLowerCase();
  return target === bundledDir || target.startsWith(bundledDir + sep);
}

export function serveDiskFile(
  req: Request,
  pathname: string,
  file: {
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly mtimeMs: number;
  },
): Response {
  return cachedResponse(req, {
    // @cast-boundary bun-types — Response BodyInit narrowing
    body: file.bytes as unknown as BodyInit,
    etag: computeWeakEtag(file.mtimeMs, file.bytes.byteLength),
    cache: staticCachePolicy(pathname),
    headers: { "content-type": file.mime },
    lastModified: new Date(file.mtimeMs),
  });
}

// Covers files produced by kumiko-build and typical public/ contents. Bun.file
// infers the type from the suffix, but the node path must do so explicitly;
// unknown types use octet-stream so the browser can handle them safely.
export function mimeTypeFor(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "html":
      return "text/html; charset=utf-8";
    case "js":
    case "mjs":
      return "text/javascript; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "ico":
      return "image/x-icon";
    case "txt":
      return "text/plain; charset=utf-8";
    case "xml":
      return "application/xml; charset=utf-8";
    case "webmanifest":
      return "application/manifest+json";
    case "woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

// `mtimeMs` is absent once page head was injected: the bytes then depend on
// DB-resolved metadata, so a shell-file mtime must not drive If-Modified-Since
// 304s (crawlers sending only that header would keep stale link previews).
type HtmlPayload = { bytes: ArrayBuffer; mime: string; etag: string; mtimeMs?: number };

export type PageHeadOptions = {
  readonly resolvePageHead: PageHeadResolver;
  readonly dispatcher: QueryDispatcher;
};

export function buildStaticFallback(
  apiHandler: (req: Request, socketAddress?: string) => Response | Promise<Response>,
  staticDir: string,
  hostDispatch?: HostDispatchFn,
  pageHead?: PageHeadOptions,
  /** Backs hostDispatch's `systemQuery` — required whenever `hostDispatch`
   *  is set (a hostDispatch that reads `deps.systemQuery` without it would
   *  throw). Separate from `pageHead.dispatcher` since resolvePageHead is
   *  optional independently of hostDispatch. */
  hostDispatchDispatcher?: QueryDispatcher,
  /** trustedProxyHops for the systemQuery request-context builds below —
   *  1:1 with runProdApp's effective value. */
  trustedProxyHops = 0,
  /** Build inline-script hashes, passed through to hostDispatch's deps. */
  hostDispatchScriptHashes: readonly string[] = [],
): (req: Request, socketAddress?: string) => Promise<Response> {
  const indexHtml = `${staticDir}/index.html`;
  const clientIpResolver: ClientIpResolver = createClientIpResolver(
    trustedProxyHops,
    "buildStaticFallback",
  );

  // Reads an HTML file from disk. No schema injection — createKumikoApp
  // fetches it itself from the authenticated GET /api/schema, so the HTML
  // is identical for every host.
  async function readHtmlFile(path: string): Promise<HtmlPayload | null> {
    const file = await readStaticFile(path);
    if (!file) return null;
    return {
      bytes: new Uint8Array(file.bytes).buffer,
      mime: file.mime,
      etag: computeWeakEtag(file.mtimeMs, file.bytes.byteLength),
      mtimeMs: file.mtimeMs,
    };
  }

  function serveHtmlFile(
    req: Request,
    pathname: string,
    html: HtmlPayload,
    extraHeaders?: Record<string, string>,
    status?: number,
  ): Response {
    // A not-found page carries no validator: a matching If-None-Match must
    // never turn a 404 into a bodyless 304.
    if (status === 404) {
      return new Response(req.method === "HEAD" ? null : html.bytes, {
        status,
        headers: { "content-type": html.mime, "cache-control": "no-store", ...extraHeaders },
      });
    }
    return cachedResponse(req, {
      status,
      body: html.bytes,
      etag: html.etag,
      cache: staticCachePolicy(pathname),
      headers: { "content-type": html.mime, ...extraHeaders },
      lastModified: html.mtimeMs === undefined ? undefined : new Date(html.mtimeMs),
    });
  }

  // Injects resolved head metadata into an already-read HTML payload, right
  // before it's served. Recomputes a strong etag over the final bytes so
  // two requests with different head metadata never collide on one etag
  // (see computeStrongEtag usage in readHtmlFile above for the same
  // requirement on schema-injection). No resolvePageHead configured, no
  // meta resolved, or nothing actually changed (e.g. no `</head>` to
  // inject into) → the original html object is returned untouched.
  //
  // The resolve+timeout+inject itself runs through headless's
  // resolveAndInjectPageHead, the same call site runDevApp uses, so only the
  // systemQuery/dispatcher wiring below (Request-bound, prod-specific) and the
  // etag recompute are local.
  async function applyPageHead(
    req: Request,
    html: HtmlPayload,
    socketAddress?: string,
  ): Promise<HtmlPayload> {
    if (!pageHead) return html;
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    const systemQuery = buildRequestBoundSystemQuery({
      req,
      dispatcher: pageHead.dispatcher,
      resolver: clientIpResolver,
      socketAddress,
    });
    const text = new TextDecoder().decode(html.bytes);
    const injected = await resolveAndInjectPageHead(text, pageHead.resolvePageHead, {
      path: url.pathname,
      host,
      preferredLocales: rankPreferredLocales({
        queryLang: url.searchParams.get("lang"),
        acceptLanguage: req.headers.get("accept-language"),
      }),
      systemQuery,
      requestSignal: req.signal,
    });
    if (injected === text) return html;
    const encoded = new TextEncoder().encode(injected);
    return {
      bytes: encoded.buffer,
      mime: html.mime,
      etag: computeStrongEtag(encoded),
    };
  }

  // Consult hostDispatch when the request reaches the HTML fallback (the root or
  // an SPA route). It can return a resolved response (redirect, 404, or HTML),
  // or null to continue with the default path.
  async function tryHostDispatch(req: Request, socketAddress?: string): Promise<Response | null> {
    if (!hostDispatch) return null;
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    const systemQuery: PageHeadSystemQuery = (type, payload, tenantId) => {
      if (!hostDispatchDispatcher) {
        throw new Error(
          "hostDispatch called deps.systemQuery but buildStaticFallback got no hostDispatchDispatcher",
        );
      }
      return buildRequestBoundSystemQuery({
        req,
        dispatcher: hostDispatchDispatcher,
        resolver: clientIpResolver,
        socketAddress,
      })(type, payload, tenantId);
    };
    const result = await hostDispatch(
      { host, path: url.pathname, search: url.search },
      { systemQuery, cspScriptHashes: hostDispatchScriptHashes },
    );
    if (result.kind === "redirect") {
      return new Response(null, {
        status: result.status ?? 302,
        headers: { Location: result.to },
      });
    }
    if (result.kind === "not-found") {
      if (result.file === undefined) return new Response("Not Found", { status: 404 });
      return serveHostDispatchFile(req, result.file, result.csp, socketAddress, 404);
    }
    return serveHostDispatchFile(req, result.file, result.csp, socketAddress, 200);
  }

  async function serveHostDispatchFile(
    req: Request,
    file: string,
    csp: string | undefined,
    socketAddress: string | undefined,
    status: number,
  ): Promise<Response> {
    const html = await readHtmlFile(`${staticDir}/${file}`);
    if (!html) {
      // Configuration error: hostDispatch references a nonexistent file. Return 500
      // instead of silently returning 404 so the problem is visible immediately.
      return new Response(`hostDispatch: file not found: ${file}`, { status: 500 });
    }
    // Per-host body (hostDispatch picks the file by host) → Vary: Host,
    // otherwise a shared cache could serve Host A's HTML to Host B.
    const extraHeaders: Record<string, string> = { vary: pageHead ? PAGE_HEAD_VARY : "Host" };
    if (csp) extraHeaders["content-security-policy"] = csp;
    const withHead = await applyPageHead(req, html, socketAddress);
    return serveHtmlFile(req, "/index.html", withHead, extraHeaders, status);
  }

  return async (req: Request, socketAddress?: string): Promise<Response> => {
    const url = new URL(req.url);
    // /api/* and /health → always Hono (Dispatcher + Health-Probe). Bypasses
    // tryHonoFirst entirely, so the router-miss marker must be stripped
    // here too — otherwise an unmatched /api/* path would leak it straight
    // to the client (see try-hono-first.ts's header-hygiene note).
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return stripNoRouteMatchHeader(await apiHandler(req, socketAddress));
    }

    // Try Hono before disk lookup so extraRoutes (for example /feed.xml and
    // /sitemap.xml) and r.httpRoute features (for example /legal/*) are handled
    // before unknown paths fall through to index.html. Keep this consistent with
    // dev-server's createKumikoServer.handleFetch so both paths have identical semantics.
    const honoTry = await tryHonoFirst({ fetch: apiHandler }, req, socketAddress);
    if (honoTry.matched) {
      return honoTry.response;
    }
    const honoRes = honoTry.response;

    // The disk/SPA fallback accepts only GET and HEAD. A non-GET without a Hono
    // match (for example, POST to a misconfigured webhook path) must preserve the
    // Hono 404: returning index.html with 200 could make the provider report the
    // event as delivered even though it was dropped.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return honoRes;
    }

    // Asset paths are host-independent because the client actively loads the
    // bundles in /assets/*; they do not require server-side routing.
    const isIndexRequest = url.pathname === "/" || url.pathname === "/index.html";
    if (!isIndexRequest) {
      const relPath = url.pathname.slice(1);
      const filePath = `${staticDir}/${relPath}`;
      const file = isInsideBundledAssetsDir(staticDir, filePath)
        ? undefined
        : await readStaticFile(filePath);
      if (file) {
        return serveDiskFile(req, url.pathname, file);
      }
    }

    // Root or SPA route — hostDispatch applies here when set.
    // Without hostDispatch: the old single-app path (index.html).
    const dispatched = await tryHostDispatch(req, socketAddress);
    if (dispatched) return dispatched;

    // Default single-app path: index.html, no schema injection.
    const index = await readHtmlFile(indexHtml);
    if (index) {
      const withHead = await applyPageHead(req, index, socketAddress);
      return serveHtmlFile(req, "/index.html", withHead, pageHead && { vary: PAGE_HEAD_VARY });
    }

    // If Hono found no route and neither a disk file nor index.html exists, preserve
    // its original 404 instead of issuing another request.
    return honoRes;
  };
}

// The resolved page head depends on host and preferred locale; ?lang= is part of the URL and
// already keys the cache.
const PAGE_HEAD_VARY = "Host, Accept-Language";

// Map URL paths to cache policies. Hashed asset paths (/assets/*) are immutable;
// other paths use revalidation or no-cache so updates take effect without a hard
// reload. Exported for unit tests; consumers access it through runProdApp.
export function staticCachePolicy(pathname: string): CachePolicy {
  if (pathname.startsWith(`/${ASSETS_DIR}/`)) {
    return { kind: "immutable" };
  }
  if (pathname === "/" || pathname === "/index.html") {
    return { kind: "revalidate" };
  }
  if (
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    // ponytail: build-info.json is static, so no /api/version endpoint is needed; the disk
    // fallback serves it. Use no-cache so UpdateChecker does not poll a stale id.
    pathname === "/build-info.json"
  ) {
    return { kind: "no-cache" };
  }
  return { kind: "none" };
}
