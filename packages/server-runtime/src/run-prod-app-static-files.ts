import {
  buildRequestContextDataFromRequest,
  type CachePolicy,
  cachedResponse,
  computeStrongEtag,
  computeWeakEtag,
  requestContext,
} from "@cosmicdrift/kumiko-framework/api";
import { createAnonymousUser, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { type ApexHead, renderApexHeadTags } from "@cosmicdrift/kumiko-headless/apex";
import { ASSETS_DIR } from "./build-prod-bundle";
import { injectSchema } from "./inject-schema";
import { injectPageHead } from "./render-head-tags";
import type {
  HostDispatchFn,
  PageHeadMeta,
  PageHeadResolver,
  PageHeadSystemQuery,
} from "./run-prod-app";
import { stripNoRouteMatchHeader, tryHonoFirst } from "./try-hono-first";

// Static-asset + SPA-fallback serving for runProdApp's HTTP handler. Split
// out of run-prod-app.ts (#1005, Welle 2) — mechanical relocation, these
// functions are self-contained (no closure over runProdApp's local boot
// state), only params.

// Static-fallback: try the Hono app first, fall back to a file in
// staticDir if Hono returns 404. Keeps /api/* on the dispatcher and
// everything else (HTML, JS, CSS, images) on the disk.
//
// Cache-Header-Strategie:
//   /assets/*               → public, max-age=31536000, immutable
//                             (gehashte Filenames vom Build, sicher cachebar)
//   /index.html             → no-cache, must-revalidate
//                             (HTML-Shell, must reload on deploy)
//   /manifest.json, /sw.js  → no-cache
//                             (Update-Detection-Mechanismen, müssen frisch sein)
//   alles andere            → kein expliziter Header
//                             (Browser-Default, public/-Files wie favicon)
// File-reader für den static-fallback. Nutzt node:fs/promises statt
// Bun.file damit der Pfad in vitest+node integration-tests laufen kann
// (Bun.file ist Bun-only). Performance-cost ist marginal: die Disk-
// Files in einem prod-staticDir sind 1-200 KB, full-buffer-Read ist
// ein paar Mikrosekunden. Streaming via Bun.file wäre nur relevant ab
// ~1 MB.
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
    const code = (err as { code?: string }).code;
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

// Minimal-Mime-Map — deckt die Files ab die kumiko-build und typische
// public/-Inhalte produzieren. Bun.file leitet das aus dem Suffix ab,
// im node-Pfad müssen wir es selbst tun. Default: octet-stream (Browser
// fragt bei unbekanntem MIME nach).
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
    default:
      return "application/octet-stream";
  }
}

// Minimal structural shape of the dispatcher buildStaticFallback needs —
// not the full Dispatcher type, so this file doesn't have to import the
// pipeline package just to type one param.
type QueryDispatcher = {
  readonly query: (type: string, payload: unknown, user: SessionUser) => Promise<unknown>;
};

export type PageHeadOptions = {
  readonly resolvePageHead: PageHeadResolver;
  readonly dispatcher: QueryDispatcher;
};

// Resolver runs alongside the request, never gates it: a slow, throwing, or
// null-returning resolver must never turn a 200 shell into a 500 or a stall.
const PAGE_HEAD_TIMEOUT_MS = 300;

export function buildStaticFallback(
  apiHandler: (req: Request) => Response | Promise<Response>,
  staticDir: string,
  appSchemaJson: string,
  hostDispatch?: HostDispatchFn,
  pageHead?: PageHeadOptions,
): (req: Request) => Promise<Response> {
  const indexHtml = `${staticDir}/index.html`;

  // Helper: liest eine HTML-Datei von der Disk + (optional) injiziert
  // das pre-serialized AppSchema vor dem client.js-Tag. Schema-Injection
  // ist explicit-opt-in damit Public-Domain-Antworten die Admin-UI-
  // Topologie nicht leaken. injectSchema ist idempotent, doppelte Calls
  // produzieren keinen doppelten Tag.
  async function readHtmlFile(
    path: string,
    injectSchemaInto: boolean,
  ): Promise<{ bytes: ArrayBuffer; mime: string; etag: string; mtimeMs: number } | null> {
    const file = await readStaticFile(path);
    if (!file) return null;
    if (!injectSchemaInto) {
      return {
        bytes: file.bytes.buffer.slice(
          file.bytes.byteOffset,
          file.bytes.byteOffset + file.bytes.byteLength,
        ) as ArrayBuffer,
        mime: file.mime,
        etag: computeWeakEtag(file.mtimeMs, file.bytes.byteLength),
        mtimeMs: file.mtimeMs,
      };
    }
    const text = new TextDecoder().decode(file.bytes);
    const injected = injectSchema(text, appSchemaJson);
    const bytes = new TextEncoder().encode(injected).buffer as ArrayBuffer;
    return {
      bytes,
      mime: file.mime,
      etag: computeStrongEtag(new Uint8Array(bytes)),
      mtimeMs: file.mtimeMs,
    };
  }

  function serveHtmlFile(
    req: Request,
    pathname: string,
    html: { bytes: ArrayBuffer; mime: string; etag: string; mtimeMs: number },
    extraHeaders?: Record<string, string>,
  ): Response {
    return cachedResponse(req, {
      body: html.bytes,
      etag: html.etag,
      cache: staticCachePolicy(pathname),
      headers: { "content-type": html.mime, ...extraHeaders },
      lastModified: new Date(html.mtimeMs),
    });
  }

  // ApexHead.lang is required (html lang="..."); PageHeadMeta only carries
  // og:locale-shaped strings ("de_DE", "en-US") since that's all og:locale
  // needs. Take the language subtag before the region separator; default to
  // "en" when there's no locale to derive one from.
  function apexLangFromLocale(locale: string | undefined): string {
    return locale?.split(/[_-]/)[0]?.toLowerCase() || "en";
  }

  function toApexHead(meta: PageHeadMeta): ApexHead {
    return {
      lang: apexLangFromLocale(meta.locale),
      title: meta.title,
      description: meta.description ?? "",
      ...(meta.canonicalUrl !== undefined ? { canonicalUrl: meta.canonicalUrl } : {}),
      ...(meta.ogImage !== undefined ? { ogImage: meta.ogImage } : {}),
      ...(meta.siteName !== undefined ? { siteName: meta.siteName } : {}),
      ...(meta.locale !== undefined ? { locale: meta.locale } : {}),
    };
  }

  // Resolves per-request head metadata, capped at PAGE_HEAD_TIMEOUT_MS.
  // Never throws — a failing/slow/absent resolver just means "no head
  // metadata this request", not a broken response.
  async function resolvePageHeadMeta(req: Request): Promise<PageHeadMeta | null> {
    if (!pageHead) return null;
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    const systemQuery: PageHeadSystemQuery = (type, payload, tenantId) =>
      requestContext.run(requestContext.get() ?? buildRequestContextDataFromRequest(req), () =>
        pageHead.dispatcher.query(type, payload, createAnonymousUser(tenantId)),
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PAGE_HEAD_TIMEOUT_MS);
      });
      // .catch on the resolver's own promise (not just the outer try/catch)
      // so a rejection arriving AFTER the timeout already won the race
      // doesn't surface as an unhandled rejection.
      const resolved = pageHead
        .resolvePageHead({ path: url.pathname, host, systemQuery })
        .catch(() => null);
      return await Promise.race([resolved, timedOut]);
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // Injects resolved head metadata into an already-read HTML payload, right
  // before it's served. Recomputes a strong etag over the final bytes so
  // two requests with different head metadata never collide on one etag
  // (see computeStrongEtag usage in readHtmlFile above for the same
  // requirement on schema-injection). No resolvePageHead configured, no
  // meta resolved, or nothing actually changed (e.g. no `</head>` to
  // inject into) → the original html object is returned untouched.
  async function applyPageHead(
    req: Request,
    html: { bytes: ArrayBuffer; mime: string; etag: string; mtimeMs: number },
  ): Promise<{ bytes: ArrayBuffer; mime: string; etag: string; mtimeMs: number }> {
    const meta = await resolvePageHeadMeta(req);
    if (!meta) return html;
    const text = new TextDecoder().decode(html.bytes);
    const injected = injectPageHead(text, renderApexHeadTags(toApexHead(meta)));
    if (injected === text) return html;
    const encoded = new TextEncoder().encode(injected);
    return {
      bytes: encoded.buffer as ArrayBuffer,
      mime: html.mime,
      etag: computeStrongEtag(encoded),
      mtimeMs: html.mtimeMs,
    };
  }

  // hostDispatch konsultieren wenn gesetzt UND der Request auf den
  // HTML-Fallback fällt (Root oder SPA-Route). Returnt entweder die
  // resolved Response (redirect/404/html) oder null wenn der Default-
  // Pfad weiterlaufen soll.
  async function tryHostDispatch(req: Request): Promise<Response | null> {
    if (!hostDispatch) return null;
    const url = new URL(req.url);
    const host = req.headers.get("host") ?? url.host;
    const result = hostDispatch({ host, path: url.pathname, search: url.search });
    if (result.kind === "not-found") {
      return new Response("Not Found", { status: 404 });
    }
    if (result.kind === "redirect") {
      return new Response(null, {
        status: result.status ?? 302,
        headers: { Location: result.to },
      });
    }
    // result.kind === "html"
    const filePath = `${staticDir}/${result.file}`;
    const html = await readHtmlFile(filePath, result.injectSchema === true);
    if (!html) {
      // Author-Fehler: hostDispatch verweist auf nicht-existente Datei.
      // Liefer 500 statt silent-404 damit der Bug schnell auffällt.
      return new Response(`hostDispatch: file not found: ${result.file}`, { status: 500 });
    }
    // Per-Host-Body (hostDispatch wählt die Datei nach Host) → Vary: Host,
    // sonst darf ein Shared-Cache Tenant-As Schema an Tenant B liefern.
    const extraHeaders: Record<string, string> = { vary: "Host" };
    if (result.csp) extraHeaders["content-security-policy"] = result.csp;
    const withHead = await applyPageHead(req, html);
    return serveHtmlFile(req, "/index.html", withHead, extraHeaders);
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // /api/* and /health → always Hono (Dispatcher + Health-Probe). Bypasses
    // tryHonoFirst entirely, so the router-miss marker must be stripped
    // here too — otherwise an unmatched /api/* path would leak it straight
    // to the client (see try-hono-first.ts's header-hygiene note).
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return stripNoRouteMatchHeader(await apiHandler(req));
    }

    // Hono-First für andere Pfade: extraRoutes (z.B. /feed.xml,
    // /sitemap.xml) UND r.httpRoute-Features (z.B. /legal/*) müssen vor
    // dem Disk-Lookup greifen, sonst schluckt der SPA-Fallback unten
    // unbekannte Pfade als index.html. Shared mit dev-server's
    // createKumikoServer.handleFetch damit beide IDENTISCHE Semantik haben.
    const honoTry = await tryHonoFirst({ fetch: apiHandler }, req);
    if (honoTry.matched) {
      return honoTry.response;
    }
    const honoRes = honoTry.response;

    // Disk-/SPA-Fallback ist GET/HEAD-only. Ein non-GET ohne Hono-Match
    // (z.B. POST auf einen falsch konfigurierten Webhook-Pfad) muss den
    // Hono-404 durchreichen — 200 index.html würde dem Provider
    // "delivered" signalisieren und Events gingen still verloren (#259).
    if (req.method !== "GET" && req.method !== "HEAD") {
      return honoRes;
    }

    // Disk-Datei (Asset oder konkrete File). Asset-Pfade laufen
    // host-unabhängig — die Bundles in /assets/* werden vom client
    // aktiv geladen, kein Server-side Routing nötig.
    const isIndexRequest = url.pathname === "/" || url.pathname === "/index.html";
    if (!isIndexRequest) {
      const relPath = url.pathname.slice(1);
      const filePath = `${staticDir}/${relPath}`;
      const file = await readStaticFile(filePath);
      if (file) {
        return serveDiskFile(req, url.pathname, file);
      }
    }

    // Root oder SPA-Route — hier greift hostDispatch wenn gesetzt.
    // Ohne hostDispatch: alter Single-App-Pfad (index.html mit Schema).
    const dispatched = await tryHostDispatch(req);
    if (dispatched) return dispatched;

    // Default Single-App-Pfad: index.html, schema injected.
    const index = await readHtmlFile(indexHtml, true);
    if (index) {
      const withHead = await applyPageHead(req, index);
      return serveHtmlFile(req, "/index.html", withHead);
    }

    // Kein Hono-Match, keine Disk-Datei, kein index.html → liefer den
    // ursprünglichen 404 von Hono durch (statt einen neuen Roundtrip).
    return honoRes;
  };
}

// Map URL-Pfad → Cache-Policy. Hashed-Asset-Pfade (/assets/*) sind
// unveränderlich, der Rest bleibt revalidate/no-cache damit Updates ohne
// Hard-Reload greifen. Exported für Unit-Tests; Konsumenten gehen via
// runProdApp.
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
    // ponytail: build-info.json ist statisch — kein /api/version-Endpoint
    // nötig, der Disk-Fallback serviert sie. no-cache, sonst pollt der
    // UpdateChecker eine veraltete id.
    pathname === "/build-info.json"
  ) {
    return { kind: "no-cache" };
  }
  return { kind: "none" };
}
