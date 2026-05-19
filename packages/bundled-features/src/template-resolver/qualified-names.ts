// @runtime client
// Feature name + qualified handler/query names (QN: scope:type:name).
export const TEMPLATE_RESOLVER_FEATURE = "template-resolver" as const;

export const TemplateResolverHandlers = {
  upsertSystem: "template-resolver:write:upsert-system",
  upsertTenant: "template-resolver:write:upsert-tenant",
  publish: "template-resolver:write:publish",
  archive: "template-resolver:write:archive",
} as const;

export const TemplateResolverQueries = {
  findById: "template-resolver:query:find-by-id",
  list: "template-resolver:query:list",
} as const;

export const TemplateResolverErrors = {
  notFound: "template_resource_not_found",
  invalidSlug: "invalid_slug",
  invalidLocale: "invalid_locale",
  systemAdminRequired: "system_admin_required",
  alreadyActive: "template_already_active",
  alreadyArchived: "template_already_archived",
} as const;
