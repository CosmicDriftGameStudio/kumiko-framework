// @runtime client
// Feature name + qualified handler/query names (QN: scope:type:name).
export const TEMPLATE_RESOLVER_FEATURE = "template-resolver" as const;

export const TemplateResolverHandlers = {
  upsertSystem: "template-resolver:write:upsert-system",
  upsertTenant: "template-resolver:write:upsert-tenant",
  publish: "template-resolver:write:publish",
  archive: "template-resolver:write:archive",
  set: "template-resolver:write:set",
} as const;

export const TemplateResolverQueries = {
  findById: "template-resolver:query:find-by-id",
  list: "template-resolver:query:list",
  // Public pair — anonymous-reachable, kind pinned to text-block.
  bySlug: "template-resolver:query:by-slug",
  byTenant: "template-resolver:query:by-tenant",
} as const;

// Every r.contentCollection() gets its own handler trio, so each carries that
// collection's access rule and the dispatcher enforces it. The names are
// derived from the collection id on both sides — server-side in
// createTemplateResolverFeature, client-side here.
export function collectionQueryName(collectionId: string, op: "list" | "item"): string {
  return `${TEMPLATE_RESOLVER_FEATURE}:query:${collectionId}-${op}`;
}

export function collectionHandlerName(collectionId: string): string {
  return `${TEMPLATE_RESOLVER_FEATURE}:write:${collectionId}-set`;
}

export const TemplateResolverErrors = {
  notFound: "template_resource_not_found",
  invalidSlug: "invalid_slug",
  invalidLocale: "invalid_locale",
  systemAdminRequired: "system_admin_required",
  alreadyActive: "template_already_active",
  alreadyArchived: "template_already_archived",
} as const;
