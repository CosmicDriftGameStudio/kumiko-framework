import { createLruCache } from "@cosmicdrift/kumiko-framework/utils";
import type { TemplateResource } from "./api.ts";
import { sanitizeTemplateBody } from "./document-sanitizer.ts";

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
