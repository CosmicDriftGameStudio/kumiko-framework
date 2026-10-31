import { createFallbackLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging";
import { createLruCache } from "@cosmicdrift/kumiko-framework/utils";
import { renderSafeMarkdown } from "../page-render/index.ts";
import { sanitizeDocumentHtml } from "../template-resolver/index.ts";
import type { BodyFormat } from "./constants.ts";

type WarnLogger = Pick<Logger, "warn">;

const defaultLog = createFallbackLogger("managed-pages");

const MAX_CACHED_BODIES = 500;
// Bounds the cache memory: 500 entries of arbitrary size could otherwise pin
// hundreds of MB. A bigger body is still served, just re-rendered per request.
const MAX_CACHED_BODY_LENGTH = 256 * 1024;

export type RenderablePageBody = {
  readonly tenantId: string;
  readonly slug: string;
  readonly lang: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly body: string;
  readonly bodyFormat: BodyFormat;
};

export type PageBodyRendererDeps = {
  readonly sanitizeDocument?: typeof sanitizeDocumentHtml;
  readonly renderMarkdown?: (markdown: string) => string;
  readonly maxEntries?: number;
};

// Every write bumps the version, so a (page, version) key never serves stale
// HTML.
function cacheKeyOf(page: RenderablePageBody): string {
  return [page.tenantId, page.slug, page.lang, page.version, page.updatedAt, page.bodyFormat].join(
    "\u0000",
  );
}

// Writes store the rebuilt, sanitized HTML, but rows can predate that validation
// or arrive through other writers, so a render still sanitizes — once per page
// version instead of once per request. A rejected document renders as an empty
// body (never the raw HTML), is logged on the miss, and the empty result is cached.
export function createPageBodyRenderer(
  deps: PageBodyRendererDeps = {},
): (page: RenderablePageBody, log?: WarnLogger) => string {
  const sanitizeDocument = deps.sanitizeDocument ?? sanitizeDocumentHtml;
  const renderMarkdown = deps.renderMarkdown ?? renderSafeMarkdown;
  const maxEntries = deps.maxEntries ?? MAX_CACHED_BODIES;
  const cache = createLruCache<string, string>({ maxEntries });

  function renderUncached(page: RenderablePageBody, log: WarnLogger): string {
    if (page.bodyFormat === "markdown") return renderMarkdown(page.body);
    const result = sanitizeDocument(page.body);
    if (result.ok) return result.html;
    log.warn("managed page document body rejected at render, serving an empty body", {
      slug: page.slug,
      violations: result.violations.map((violation) => violation.code),
    });
    return "";
  }

  return (page, log = defaultLog) => {
    const key = cacheKeyOf(page);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const html = renderUncached(page, log);
    if (html.length > MAX_CACHED_BODY_LENGTH) return html;
    cache.set(key, html);
    return html;
  };
}

export const renderPageBody = createPageBodyRenderer();
