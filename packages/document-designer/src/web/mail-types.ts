import type { ValidationIssue } from "./layout-types.ts";
import type { ServedVersionView } from "./types.ts";

export type PlaceholderType = "text" | "money" | "date" | "percent" | "link" | "list";

export type MailVariable = {
  readonly type: PlaceholderType;
  readonly label?: string;
  readonly required?: boolean;
  readonly example?: unknown;
  readonly item?: Readonly<
    Record<string, { readonly type: PlaceholderType; readonly label?: string }>
  >;
};

export type MailWarning = {
  readonly code: string;
  readonly detail: string;
  readonly i18nKey: string;
};

export type MailValidation = {
  readonly canSave: boolean;
  readonly canPublish: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly publishIssues: readonly ValidationIssue[];
  readonly used: readonly string[];
  readonly unknown: readonly string[];
  readonly missingRequired: readonly string[];
  readonly warnings: readonly MailWarning[];
  readonly variables: Readonly<Record<string, MailVariable>>;
  readonly systemPlaceholders: readonly string[];
};

export type PreviewAttachment =
  | { readonly kind: "inline"; readonly name: string; readonly sizeBytes: number }
  | { readonly kind: "file"; readonly name: string; readonly sizeBytes: number }
  | { readonly kind: "rendered-pdf"; readonly name: string; readonly templateSlug: string };

export type PreviewCheck = {
  readonly code: string;
  readonly ok: boolean;
  readonly i18nKey: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

export type MailPreview = {
  readonly subject: string | null;
  readonly html: string;
  readonly displayHtml?: string;
  readonly text: string | null;
  readonly attachments: readonly PreviewAttachment[];
  readonly mailLayout?: {
    readonly slug: string;
    readonly scope: string;
    readonly version: number;
  } | null;
  readonly sampleValues: Readonly<Record<string, unknown>>;
  readonly checks: readonly PreviewCheck[];
};

export type TemplateRowSummary = {
  readonly id: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly scope: "tenant" | "system";
  readonly status: string;
  readonly modifiedAt: string;
};

// The stored row as find-by-id returns it; JSON columns arrive as strings or objects.
export type TemplateRowView = {
  readonly id: string;
  readonly version: number;
  readonly slug: string;
  readonly locale: string;
  readonly scope: "tenant" | "system";
  readonly status: string;
  readonly content: string;
  readonly variableSchema: unknown;
  readonly linkedResources: unknown;
  readonly meta: unknown;
  readonly modifiedAt: string | null;
  readonly active?: ServedVersionView | null;
};

export type MailCategory = "" | "transactional" | "marketing";

export type MailDraft = {
  readonly subject: string;
  readonly previewText: string;
  readonly layoutSlug: string;
  readonly category: MailCategory;
  readonly senderName: string;
  readonly replyTo: string;
  /** Placeholder lines; an empty tone stores the accent default. */
  readonly headerChip: string;
  readonly tone: string;
  readonly footerNote: string;
  readonly body: string;
};

export type LinkedResourceView =
  | { readonly kind: "image"; readonly key: string; readonly fileRefId: string }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly fileRefId: string;
      readonly fileName: string;
    }
  | {
      readonly kind: "pdf";
      readonly key: string;
      readonly templateSlug: string;
      readonly fileName: string;
    };

export type UpsertResponse = { readonly id: string };

export type SendTestResponse = { readonly subject: string };

export type SendTestStatus = {
  readonly canSend: boolean;
  readonly reason: "no_channel" | "no_address" | null;
};

export type PickedValues = Readonly<Record<string, unknown>>;
