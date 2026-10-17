export {
  createTemplateResolverApi,
  type ResolveRequest,
  requireTemplateResolver,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "./api.js";
export {
  type CompileDocumentBodyOptions,
  collectDocumentResourceKeys,
  compileDocumentBodyToHandlebars,
  toResourceDataUri,
} from "./compile-document-body.js";
export {
  CONTENT_FORMATS,
  type ContentFormat,
  DEFAULT_MAIL_LAYOUT_SLUG,
  DEFAULT_PDF_LAYOUT_SLUG,
  DOCUMENT_HTML_KINDS,
  type DocumentHtmlKind,
  FALLBACK_LOCALE,
  NON_RENDER_KINDS,
  type NonRenderKind,
  PDF_DEFAULT_MARGIN_MM,
  PDF_FOOTER_MARGIN_MM,
  PDF_HEADER_MARGIN_MM,
  PDF_ORIENTATIONS,
  PDF_PAGE_FORMATS,
  type PdfOrientation,
  type PdfPageFormat,
  RENDER_KINDS,
  type RenderKind,
  SYSTEM_TENANT_ID,
  TEMPLATE_KINDS,
  TEMPLATE_SCOPES,
  TEMPLATE_STATUSES,
  TEXT_BLOCK_KIND,
  type TemplateKind,
  type TemplateScope,
  type TemplateStatus,
  UPSERT_KINDS,
  type UpsertKind,
} from "./constants.js";
export {
  type DocumentViolation,
  type DocumentViolationCode,
  documentViolationsToFieldIssues,
  type SanitizeBodyResult,
  type SanitizeHtmlResult,
  sanitizeDocumentHtml,
  sanitizeTemplateBody,
} from "./document-sanitizer.js";
export {
  DOCUMENT_NODE_NAMES,
  DOCUMENT_TEXT_ALIGNMENTS,
  DocumentButton,
  DocumentDivider,
  DocumentLink,
  DocumentPageBreak,
  DocumentResource,
  DocumentTable,
  DocumentTableCell,
  DocumentTableHeader,
  DocumentTableRow,
  DocumentTextAlign,
  type DocumentTextAlignment,
  DocumentVariable,
  documentExtensions,
  isAllowedDocumentLinkHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./document-schema.js";
export { createTemplateResolverFeature } from "./feature.js";
export type { LayoutSourceResponse, LayoutSourceRow } from "./handlers/layout-source.query.js";
export type {
  OverviewKindGroup,
  OverviewOrigin,
  OverviewResponse,
  OverviewRow,
  OverviewUsage,
} from "./handlers/overview.query.js";
export { localeSchema } from "./handlers/shared.js";
export {
  isHexColor,
  type MailLayoutAppearance,
  mailLayoutAppearance,
} from "./layout-appearance.js";
export {
  type LayoutRegions,
  readLayoutRegions,
  type SanitizeLayoutResult,
  sanitizeLayoutHtml,
} from "./layout-regions.js";
export {
  fileAttachmentsOf,
  imageLinksOf,
  type LinkedResourceEntry,
  parseLinkedResourceEntries,
  pdfAttachmentLinksOf,
  type TemplatePdfAttachmentLink,
  templatePdfAttachmentLinkSchema,
} from "./linked-resources.js";
export { prepareDocumentForPrint } from "./print-document.js";
export {
  TEMPLATE_RESOLVER_FEATURE,
  TemplateResolverErrors,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "./qualified-names.js";
export { mapRecordToVariables } from "./record-mapping.js";
export {
  readTemplateResourceMaxBytes,
  type StoredTemplateResource,
  storeTemplateResource,
} from "./store-template-resource.js";
export {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "./table.js";
export { type TemplateBundle, templateBundleSchema } from "./template-bundle.js";
export {
  isMailTemplateMeta,
  type LayoutTemplateMeta,
  MAIL_CATEGORIES,
  MAIL_TONES,
  type MailCategory,
  type MailLayoutMeta,
  type MailTemplateMeta,
  type MailTone,
  type PdfTemplateMeta,
  parseTemplateMeta,
  pdfAttachmentFileNamePatternSchema,
  readMailLayoutMeta,
  readPdfTemplateMeta,
  type TemplateMeta,
  type TemplateMetaIssue,
  type TemplateMetaResult,
  templateSlugSchema,
} from "./template-meta.js";
export { type DocumentDraftOutcome, evaluateDocumentDraft } from "./template-preview.js";
export { readTemplateResource, type TemplateResourceFile } from "./template-resources.js";
export { collectTemplateUsage, type TemplateUsageEntry } from "./template-usage.js";
export {
  hasPlaceholderProblems,
  resolveTemplateVariables,
  SYSTEM_PLACEHOLDERS,
  systemPlaceholdersFor,
  type TemplateValidation,
  validateTemplatePlaceholders,
} from "./template-validation.js";
export {
  type UserContentEntryRow,
  userContentEntriesTable,
  userContentEntryEntity,
} from "./user-content-table.js";
