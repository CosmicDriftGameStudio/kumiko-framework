import { createLruCache } from "@cosmicdrift/kumiko-framework/utils";
import type { ResolveLayoutRequest, TemplateResolverApi, TemplateResource } from "./api.ts";
import { sanitizeTemplateBody } from "./document-sanitizer.ts";
import { sanitizeLayoutHtml } from "./layout-regions.ts";
import { SYSTEM_TENANT_ID } from "./web/constants.ts";

const MAX_CACHED_BODIES = 500;
const MAX_CACHED_BODY_LENGTH = 256 * 1024;
// id + version name one immutable stored body; null caches a rejection.
const checkedBodies = createLruCache<string, string | null>({ maxEntries: MAX_CACHED_BODIES });

// Like tenant layouts, a tenant body is re-checked on every render: rows written before the write
// gate existed or through another path must not reach a mail or PDF unsanitized. null = rejected,
// the caller falls back to the system template of the same slug.
export function revalidateStoredTemplateBody(template: TemplateResource): TemplateResource | null {
  if (template.scope === "system") return template;
  const key = `${template.id}:${template.version}`;
  let content = checkedBodies.get(key);
  if (content === undefined) {
    const result = sanitizeTemplateBody({
      kind: template.kind,
      contentFormat: template.contentFormat,
      content: template.content,
    });
    content = result.ok ? (result.content ?? template.content) : null;
    if (template.content.length <= MAX_CACHED_BODY_LENGTH) checkedBodies.set(key, content);
  }
  return content === null ? null : { ...template, content };
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
