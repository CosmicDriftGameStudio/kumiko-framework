import { createLruCache } from "@cosmicdrift/kumiko-framework/utils";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { ResolveLayoutRequest, TemplateResolverApi, TemplateResource } from "./api.ts";
import { sanitizeTemplateBody } from "./document-sanitizer.ts";
import { sanitizeLayoutHtml } from "./layout-regions.ts";
import type { TemplateResourceRow } from "./table.ts";
import {
  CONTENT_FORMATS,
  type ContentFormat,
  SYSTEM_TENANT_ID,
  TEXT_BLOCK_KIND,
} from "./web/constants.ts";

const MAX_CACHED_BODIES = 500;
const MAX_CACHED_BODY_LENGTH = 256 * 1024;
// id + version name one immutable stored body; null caches a rejection.
const checkedBodies = createLruCache<string, string | null>({ maxEntries: MAX_CACHED_BODIES });

type StoredBody = {
  readonly id: string | number;
  readonly version: number;
  readonly kind: string;
  readonly contentFormat: ContentFormat;
  readonly content: string;
};

// null = rejected. id + version name one immutable stored body, so it is sanitized once per version;
// the mode is part of the key because the render path leaves text-block html as is.
function checkedStoredBody(body: StoredBody, alwaysSanitizeHtml: boolean): string | null {
  const key = `${body.id}:${body.version}:${alwaysSanitizeHtml ? "gate" : "kind"}`;
  const cached = checkedBodies.get(key);
  if (cached !== undefined) return cached;
  const result = sanitizeTemplateBody({
    kind: body.kind,
    contentFormat: body.contentFormat,
    content: body.content,
    alwaysSanitizeHtml,
  });
  const content = result.ok ? (result.content ?? body.content) : null;
  if (body.content.length <= MAX_CACHED_BODY_LENGTH) checkedBodies.set(key, content);
  return content;
}

// Like tenant layouts, a tenant body is re-checked on every render: rows written before the write
// gate existed or through another path must not reach a mail or PDF unsanitized. null = rejected,
// the caller falls back to the system template of the same slug.
export function revalidateStoredTemplateBody(template: TemplateResource): TemplateResource | null {
  if (template.scope === "system") return template;
  const content = checkedStoredBody(template, false);
  return content === null ? null : { ...template, content };
}

// The anonymous text-block reads apply the write gate to stored rows too: an html body stored before
// the gate or through a seed/import is served sanitized, a rejected one as null (the content tree
// shows it as a stub). System rows stay trusted as written, as for rendering.
export function deliverableTextBlockContent(
  row: Pick<TemplateResourceRow, "id" | "version" | "scope" | "contentFormat" | "content">,
): string | null {
  if (row.scope === "system" || row.content === null) return row.content;
  const contentFormat = row.contentFormat;
  if (!isOneOf(CONTENT_FORMATS, contentFormat)) return null;
  return checkedStoredBody(
    {
      id: row.id,
      version: row.version,
      kind: TEXT_BLOCK_KIND,
      contentFormat,
      content: row.content,
    },
    true,
  );
}

// Only system layouts are trusted as written: a tenant row is re-checked on every render and replaced
// by the system layout of the same slug when it is not html or fails the layout sanitizer.
export async function resolveTrustedLayout(
  api: TemplateResolverApi,
  request: ResolveLayoutRequest,
  alreadyResolved?: TemplateResource,
): Promise<TemplateResource> {
  const layout = alreadyResolved ?? (await api.resolveLayout(request));
  if (layout.scope === "system") return layout;
  if (layout.contentFormat === "html") {
    const sanitized = sanitizeLayoutHtml(layout.content);
    if (sanitized.ok) return { ...layout, content: sanitized.html };
  }
  return api.resolveLayout({
    tenantId: SYSTEM_TENANT_ID,
    slug: request.slug,
    kind: request.kind,
    locale: request.locale,
  });
}
