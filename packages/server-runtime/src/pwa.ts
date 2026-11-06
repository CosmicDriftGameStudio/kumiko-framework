import { createHash } from "node:crypto";
import {
  escapeHtmlAttr,
  PWA_CACHE_SCOPE_HASH_LENGTH,
  PWA_SERVICE_WORKER_META_NAME,
} from "@cosmicdrift/kumiko-renderer/headless";
import { buildPwaServiceWorkerScript, PWA_CACHE_NAME_PREFIX } from "./pwa-service-worker-script.ts";

export type PwaIconPurpose = "any" | "maskable" | "monochrome";

export type PwaIcon = {
  /** Same-origin path, e.g. `/icons/app-192.png`; the app serves the file itself (usually from `public/`). */
  readonly src: string;
  /** `"192x192"`, several sizes separated by spaces, or `"any"` for SVG. */
  readonly sizes: string;
  readonly type?: string;
  readonly purpose?: PwaIconPurpose;
};

export type PwaOptions = {
  readonly name: string;
  readonly shortName: string;
  readonly themeColor: string;
  readonly backgroundColor: string;
  readonly icons: readonly PwaIcon[];
  /** Directory the app is served under, e.g. `/a/`; starts and ends with `/`. Default `/`. */
  readonly basePath?: string;
};

const DEFAULT_PWA_BASE_PATH = "/";
const MANIFEST_FILE = "manifest.webmanifest";
const SERVICE_WORKER_FILE = "sw.js";

type PwaPaths = {
  readonly shellUrl: string;
  readonly manifestPath: string;
  readonly serviceWorkerPath: string;
};

function pwaPathsOf(options: PwaOptions): PwaPaths {
  const basePath = options.basePath ?? DEFAULT_PWA_BASE_PATH;
  return {
    shellUrl: basePath,
    manifestPath: `${basePath}${MANIFEST_FILE}`,
    serviceWorkerPath: `${basePath}${SERVICE_WORKER_FILE}`,
  };
}

export type PwaShellBuild = {
  /** Same-origin URLs of the client bundles and stylesheet the shell loads. */
  readonly appShellUrls: readonly string[];
  /** Changes whenever the served bundles change, so a new build gets a new cache. */
  readonly buildToken: string;
};

export type PwaShell = {
  readonly cacheName: string;
  readonly injectHeadTags: (html: string) => string;
  /** undefined: not a PWA file, the request goes on to the normal routes. */
  readonly respond: (req: Request, pathname: string) => Response | undefined;
};

// "/x" only: "//host/x" and "/\host" are protocol-relative to browsers (which also strip tab and
// newline before parsing), and the worker precaches every icon, so a foreign URL would be fetched
// from the user's browser.
function isSameOriginPath(src: string): boolean {
  return /^\/(?![/\\])/.test(src) && !src.includes("\\") && !/[\s\p{Cc}]/u.test(src);
}

function isValidBasePath(basePath: string): boolean {
  if (!isSameOriginPath(basePath) || !basePath.endsWith("/")) return false;
  if (basePath.includes("?") || basePath.includes("#")) return false;
  const segments = basePath.slice(1, -1).split("/");
  if (basePath === "/") return true;
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function assertValidPwaOptions(options: PwaOptions): void {
  const basePath = options.basePath;
  if (basePath !== undefined && !isValidBasePath(basePath)) {
    throw new Error(
      `[pwa] basePath "${basePath}" must be a same-origin path that starts and ends with "/", has no empty, "." or ".." segment and no "?" or "#".`,
    );
  }
  for (const icon of options.icons) {
    if (!isSameOriginPath(icon.src)) {
      throw new Error(
        `[pwa] icon src "${icon.src}" must be a same-origin path starting with a single "/".`,
      );
    }
  }
}

export function buildWebManifest(options: PwaOptions): Readonly<Record<string, unknown>> {
  const { shellUrl } = pwaPathsOf(options);
  return {
    id: shellUrl,
    name: options.name,
    short_name: options.shortName,
    start_url: shellUrl,
    scope: shellUrl,
    display: "standalone",
    theme_color: options.themeColor,
    background_color: options.backgroundColor,
    icons: options.icons.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      ...(icon.type !== undefined && { type: icon.type }),
      ...(icon.purpose !== undefined && { purpose: icon.purpose }),
    })),
  };
}

function largestEdge(sizes: string): number {
  return Math.max(0, ...sizes.split(/\s+/).map((size) => Number.parseInt(size, 10) || 0));
}

// iOS ignores the manifest icons and crops maskable artwork badly, so it gets the
// largest plain icon.
function pickAppleTouchIcon(icons: readonly PwaIcon[]): PwaIcon | undefined {
  const plain = icons.filter((icon) => icon.purpose === undefined || icon.purpose === "any");
  return [...plain].sort((a, b) => largestEdge(b.sizes) - largestEdge(a.sizes))[0];
}

function buildHeadTags(options: PwaOptions): string {
  const appleIcon = pickAppleTouchIcon(options.icons);
  const { manifestPath, serviceWorkerPath } = pwaPathsOf(options);
  return [
    `<link rel="manifest" href="${escapeHtmlAttr(manifestPath)}" />`,
    `<meta name="theme-color" content="${escapeHtmlAttr(options.themeColor)}" />`,
    `<meta name="mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-capable" content="yes" />`,
    `<meta name="apple-mobile-web-app-title" content="${escapeHtmlAttr(options.shortName)}" />`,
    ...(appleIcon
      ? [`<link rel="apple-touch-icon" href="${escapeHtmlAttr(appleIcon.src)}" />`]
      : []),
    `<meta name="${PWA_SERVICE_WORKER_META_NAME}" content="${escapeHtmlAttr(serviceWorkerPath)}" />`,
  ].join("\n    ");
}

function computeCacheVersion(options: PwaOptions, build: PwaShellBuild): string {
  return createHash("sha256").update(JSON.stringify({ options, build })).digest("hex").slice(0, 16);
}

function fileResponse(req: Request, body: string, contentType: string): Response {
  return new Response(req.method === "HEAD" ? null : body, {
    headers: { "content-type": contentType, "cache-control": "no-cache" },
  });
}

export function createPwaShell(options: PwaOptions, build: PwaShellBuild): PwaShell {
  assertValidPwaOptions(options);
  const paths = pwaPathsOf(options);
  const cacheScopePrefix = `${PWA_CACHE_NAME_PREFIX}${createHash("sha256").update(paths.shellUrl).digest("hex").slice(0, PWA_CACHE_SCOPE_HASH_LENGTH)}-`;
  const cacheName = `${cacheScopePrefix}${computeCacheVersion(options, build)}`;
  const precacheUrls = [
    ...new Set([
      paths.shellUrl,
      paths.manifestPath,
      ...options.icons.map((icon) => icon.src),
      ...build.appShellUrls,
    ]),
  ];
  const manifestBody = JSON.stringify(buildWebManifest(options));
  const serviceWorkerBody = buildPwaServiceWorkerScript({
    cacheName,
    cacheScopePrefix,
    precacheUrls,
    shellUrl: paths.shellUrl,
    serviceWorkerPath: paths.serviceWorkerPath,
  });
  const headTagsHtml = buildHeadTags(options);

  return {
    cacheName,
    injectHeadTags: (html) =>
      // A replacer function, so a "$&" in an app name is not read as a replacement pattern.
      html.includes("</head>")
        ? html.replace("</head>", () => `  ${headTagsHtml}\n  </head>`)
        : html,
    respond: (req, pathname) => {
      if (req.method !== "GET" && req.method !== "HEAD") return undefined;
      if (pathname === paths.manifestPath) {
        return fileResponse(req, manifestBody, "application/manifest+json");
      }
      if (pathname === paths.serviceWorkerPath) {
        return fileResponse(req, serviceWorkerBody, "text/javascript; charset=utf-8");
      }
      return undefined;
    },
  };
}
