// @runtime client
import type { FieldIssue } from "@cosmicdrift/kumiko-headless";

export type TemplateScope = "system" | "tenant";
export type TemplateStatus = "draft" | "active" | "archived";

export const DOCUMENT_PDF_KIND = "document-pdf" as const;
export const PDF_LAYOUT_KIND = "pdf-layout" as const;
export const DEFAULT_LAYOUT_SLUG = "default";

export type TemplateListRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly scope: TemplateScope;
  readonly status: TemplateStatus;
  readonly contentFormat: string;
  readonly modifiedAt: string | null;
};

export type TemplateDetail = {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly content: string;
  readonly contentFormat: string;
  readonly variableSchema: string | null;
  readonly linkedResources: string | null;
  readonly meta: string | null;
  readonly scope: TemplateScope;
  readonly parentTemplateId: string | null;
  readonly status: TemplateStatus;
  readonly modifiedAt: string | null;
};

export type VariableType = "text" | "link" | "money" | "date" | "list";

export type VariableInfo = {
  readonly type: VariableType;
  readonly label?: string;
  readonly required?: boolean;
};

export type ValidationWarning = {
  readonly code: string;
  readonly detail: string;
  readonly i18nKey: string;
};

export type ValidationResult = {
  readonly canSave: boolean;
  readonly canPublish: boolean;
  readonly issues: readonly FieldIssue[];
  readonly publishIssues: readonly FieldIssue[];
  readonly used: readonly string[];
  readonly unknown: readonly string[];
  readonly missingRequired: readonly string[];
  readonly warnings: readonly ValidationWarning[];
  readonly variables: Readonly<Record<string, VariableInfo>>;
  readonly systemPlaceholders: readonly string[];
};

export type LayoutRegionsHtml = {
  readonly header: string;
  readonly signature: string;
  readonly footer: string;
};

export type PreviewResult = {
  readonly layout: {
    readonly slug: string;
    readonly scope: TemplateScope;
    readonly html: string;
    readonly regions: LayoutRegionsHtml;
  } | null;
};

export type PuppeteerStatus =
  | { readonly available: true }
  | { readonly available: false; readonly error?: string; readonly message?: string };

export type PdfPreviewResult = {
  readonly fileName: string;
  readonly pdfBase64: string;
  readonly pageCount: number;
  readonly sizeBytes: number;
  readonly durationMs: number;
};

export type TenantOverrides = {
  readonly activeOverrides: number;
  readonly draftOverrides: number;
  readonly totalTenants: number | null;
};

export type SaveResult = {
  readonly id: string;
  readonly slug: string;
  readonly isNew: boolean;
};

export type TemplateUsage = {
  readonly usedBy: readonly {
    readonly qualifiedName: string;
    readonly feature: string;
    readonly notification: string;
    readonly trigger: string | null;
    readonly role: string;
  }[];
};
