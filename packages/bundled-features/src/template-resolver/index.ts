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
  DOCUMENT_HTML_KINDS,
  type DocumentHtmlKind,
  FALLBACK_LOCALE,
  NON_RENDER_KINDS,
  type NonRenderKind,
  PDF_PAGE_FORMATS,
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
  DocumentButton,
  DocumentDivider,
  DocumentLink,
  DocumentPageBreak,
  DocumentRepeatRow,
  DocumentResource,
  DocumentTable,
  DocumentTableCell,
  DocumentTableHeader,
  DocumentTableRow,
  DocumentVariable,
  documentExtensions,
  isAllowedDocumentLinkHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./document-schema.js";
export { createTemplateResolverFeature } from "./feature.js";
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
  type MailCategory,
  type MailTemplateMeta,
  type PdfTemplateMeta,
  parseTemplateMeta,
  pdfAttachmentFileNamePatternSchema,
  readPdfTemplateMeta,
  type TemplateMeta,
  type TemplateMetaIssue,
  type TemplateMetaResult,
  templateSlugSchema,
} from "./template-meta.js";
export { readTemplateResource, type TemplateResourceFile } from "./template-resources.js";
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
