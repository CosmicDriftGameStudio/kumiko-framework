// @runtime client
// Feature name + qualified handler/query names (QN: scope:type:name).
export const TEMPLATE_RESOLVER_FEATURE = "template-resolver" as const;

export const TemplateResolverHandlers = {
  upsertSystem: "template-resolver:write:upsert-system",
  upsertTenant: "template-resolver:write:upsert-tenant",
  publish: "template-resolver:write:publish",
  archive: "template-resolver:write:archive",
  publishSystem: "template-resolver:write:publish-system",
  archiveSystem: "template-resolver:write:archive-system",
  discardDraft: "template-resolver:write:discard-draft",
  discardDraftSystem: "template-resolver:write:discard-draft-system",
  resetToSystem: "template-resolver:write:reset-to-system",
  set: "template-resolver:write:set",
  importBundle: "template-resolver:write:import-bundle",
  importBundleSystem: "template-resolver:write:import-bundle-system",
  copyLocale: "template-resolver:write:copy-locale",
  resourceUpload: "template-resolver:write:resource-upload",
  resourceRemove: "template-resolver:write:resource-remove",
  resourceLinkPdf: "template-resolver:write:resource-link-pdf",
  sendTest: "template-resolver:write:send-test",
} as const;

export const TemplateResolverQueries = {
  findById: "template-resolver:query:find-by-id",
  list: "template-resolver:query:list",
  usage: "template-resolver:query:usage",
  overview: "template-resolver:query:overview",
  layoutSource: "template-resolver:query:layout-source",
  tenantOverrides: "template-resolver:query:tenant-overrides",
  diffToSystem: "template-resolver:query:diff-to-system",
  validate: "template-resolver:query:validate",
  preview: "template-resolver:query:preview",
  exportBundle: "template-resolver:query:export-bundle",
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
  noDraft: "no_draft",
  alreadyActive: "template_already_active",
  alreadyArchived: "template_already_archived",
  targetExists: "target_exists",
  systemResourcesNeedSystemTenant: "system_resources_need_system_tenant",
  systemOnlyTemplate: "system_only_template",
  bundleLocalesDiffer: "bundle_locales_differ",
  resourceTooLarge: "template_resource_too_large",
  resourceUnsupportedImage: "template_resource_unsupported_image",
  attachmentUnsupportedType: "template_attachment_unsupported_type",
  attachmentLimit: "template_attachment_limit",
  attachmentInvalid: "template_attachment_invalid",
  attachmentPdfTemplateMissing: "template_attachment_pdf_template_missing",
  previewRenderFailed: "template_preview_render_failed",
  testMailNoChannel: "template_test_mail_no_channel",
  testMailNoAddress: "template_test_mail_no_address",
  testMailFailed: "template_test_mail_failed",
} as const;
