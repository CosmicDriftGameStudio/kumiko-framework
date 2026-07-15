import {
  type CachePolicy,
  cachedResponse,
  computeStrongEtag,
  computeWeakEtag,
} from "@cosmicdrift/kumiko-framework/api";
import { ASSETS_DIR } from "./build-prod-bundle";
import { injectSchema } from "./inject-schema";
import type { HostDispatchFn } from "./run-prod-app";
import { tryHonoFirst } from "./try-hono-first";

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
    if ((err as { code?: string }).code === "ENOENT") return undefined;
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

export function buildStaticFallback(
  apiHandler: (req: Request) => Response | Promise<Response>,
  staticDir: string,
  appSchemaJson: string,
  hostDispatch?: HostDispatchFn,
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
    return serveHtmlFile(req, "/index.html", html, extraHeaders);
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    // /api/* and /health → always Hono (Dispatcher + Health-Probe).
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return apiHandler(req);
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
      return serveHtmlFile(req, "/index.html", index);
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
