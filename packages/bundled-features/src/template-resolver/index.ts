export { isResourceImageContentType } from "../shared/index.ts";
export {
  createTemplateResolverApi,
  type ResolveRequest,
  requireTemplateResolver,
  TemplateNotFoundError,
  type TemplateResolverApi,
  type TemplateResource,
} from "./api.ts";
export {
  type CompileDocumentBodyOptions,
  collectDocumentImageVariables,
  collectDocumentResourceKeys,
  compileDocumentBodyToHandlebars,
  toResourceDataUri,
} from "./compile-document-body.ts";
export {
  type DocumentViolation,
  type DocumentViolationCode,
  documentViolationsToFieldIssues,
  flattenParagraphsToLineBreaks,
  type SanitizeBodyResult,
  type SanitizeHtmlResult,
  sanitizeDocumentHtml,
  sanitizeTemplateBody,
} from "./document-sanitizer.ts";
export { createTemplateResolverFeature, type TemplateResolverOptions } from "./feature.ts";
export type { LayoutSourceResponse, LayoutSourceRow } from "./handlers/layout-source.query.ts";
export type {
  OverviewKindGroup,
  OverviewOrigin,
  OverviewResponse,
  OverviewRow,
  OverviewUsage,
} from "./handlers/overview.query.ts";
export { localeSchema } from "./handlers/shared.ts";
export {
  isHexColor,
  type MailLayoutAppearance,
  mailLayoutAppearance,
} from "./layout-appearance.ts";
export {
  type LayoutRegions,
  readLayoutRegions,
  type SanitizeLayoutResult,
  sanitizeLayoutHtml,
} from "./layout-regions.ts";
export {
  fileAttachmentsOf,
  imageLinksOf,
  type LinkedResourceEntry,
  parseLinkedResourceEntries,
  pdfAttachmentLinksOf,
  type TemplatePdfAttachmentLink,
  templatePdfAttachmentLinkSchema,
} from "./linked-resources.ts";
export { prepareDocumentForPrint } from "./print-document.ts";
export { mapRecordToVariables } from "./record-mapping.ts";
export {
  type PreparedTemplateImage,
  prepareTemplateResourceBeforeTransaction,
  readTemplateResourceMaxBytes,
  type StoredTemplateResource,
  storePreparedTemplateResource,
} from "./store-template-resource.ts";
export {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "./table.ts";
export { type TemplateBundle, templateBundleSchema } from "./template-bundle.ts";
export type { TemplateDeliveryPolicy } from "./template-delivery-policy.ts";
export {
  type TemplateEditPolicy,
  type TenantEditableTemplate,
  templateEditAccess,
} from "./template-edit-policy.ts";
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
} from "./template-meta.ts";
export { type DocumentDraftOutcome, evaluateDocumentDraft } from "./template-preview.ts";
export { readTemplateResource, type TemplateResourceFile } from "./template-resources.ts";
export { isSystemOnlyTemplate } from "./template-system-only.ts";
export { collectTemplateUsage, type TemplateUsageEntry } from "./template-usage.ts";
export {
  hasPlaceholderProblems,
  resolveTemplateVariables,
  SYSTEM_PLACEHOLDERS,
  systemPlaceholdersFor,
  type TemplateValidation,
  validateTemplatePlaceholders,
} from "./template-validation.ts";
export {
  type UserContentEntryRow,
  userContentEntriesTable,
  userContentEntryEntity,
} from "./user-content-table.ts";
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
} from "./web/constants.ts";
export {
  DOCUMENT_CONDITION_ATTRIBUTE,
  DOCUMENT_NODE_NAMES,
  DOCUMENT_TEXT_ALIGNMENTS,
  DocumentButton,
  DocumentCondition,
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
  isAllowedDocumentUrlHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./web/document-schema.ts";
export {
  TEMPLATE_RESOLVER_FEATURE,
  TemplateResolverErrors,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "./web/qualified-names.ts";
