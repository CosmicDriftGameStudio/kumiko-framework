import type { LayoutMeta } from "./layout-meta.ts";
import type { ServedVersionView } from "./types.ts";

export type LayoutKind = "mail-layout" | "pdf-layout";

export type ValidationIssue = {
  readonly path: string;
  readonly code: string;
  readonly i18nKey: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

export type LayoutValidation = {
  readonly canSave: boolean;
  readonly canPublish: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly publishIssues: readonly ValidationIssue[];
  readonly used: readonly string[];
  readonly systemPlaceholders: readonly string[];
};

export type BrandingView = {
  readonly title: string;
  readonly accentColor: string;
  readonly logoUrl: string;
  readonly logoFile: string;
  readonly siteUrl: string;
};

export type TenantOverrideCounts = {
  readonly activeOverrides: number;
  readonly draftOverrides: number;
  readonly totalTenants: number | null;
};

export type TemplateDiff = {
  readonly identical: boolean;
  readonly blocks: readonly {
    readonly change: "same" | "added" | "removed";
    readonly content: string;
  }[];
  readonly meta: readonly {
    readonly key: string;
    readonly tenant?: unknown;
    readonly system?: unknown;
  }[];
};

export type UpsertResponse = { readonly id: string };

export type LayoutSourceRow = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly locale: string;
  readonly active?: ServedVersionView | null;
};

export type LayoutSourceView = {
  readonly tenant: LayoutSourceRow | null;
  readonly system: (LayoutSourceRow & { readonly contentFormat: string }) | null;
  readonly regions: {
    readonly header: string;
    readonly signature: string;
    readonly footer: string;
  };
  readonly effectiveFormat: "html" | "mjml" | null;
  readonly mjmlSource: string | null;
  readonly meta: LayoutMeta;
  readonly locale: string;
};
