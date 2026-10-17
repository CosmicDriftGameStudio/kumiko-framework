import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { CONTENT_FORMATS, type ContentFormat } from "./constants.js";
import type { TemplateResourceRow } from "./table.js";

const templateDraftSchema = z.object({
  content: z.string().nullable(),
  contentFormat: z.enum(CONTENT_FORMATS),
  variableSchema: z.string(),
  meta: z.string().nullable(),
  title: z.string().nullable(),
  folder: z.string().nullable(),
  parentTemplateId: z.string().nullable(),
});

// An unpublished edit beside the active version; variableSchema and meta stay
// JSON strings, exactly like the columns they replace on publish.
export type TemplateDraft = {
  readonly content: string | null;
  readonly contentFormat: ContentFormat;
  readonly variableSchema: string;
  readonly meta: string | null;
  readonly title: string | null;
  readonly folder: string | null;
  readonly parentTemplateId: string | null;
};

export function parseTemplateDraft(raw: string | null): TemplateDraft | null {
  if (raw === null) return null;
  try {
    const parsed = templateDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function serializeTemplateDraft(draft: TemplateDraft): string {
  return JSON.stringify(draft);
}

export function activeVersionOf(row: TemplateResourceRow): number {
  return row.activeVersion ?? row.version;
}

// `version` also counts draft saves, so only a row without a served version shows it as its number.
export function servedVersionOf(row: TemplateResourceRow): number {
  return row.status === "active" ? activeVersionOf(row) : row.version;
}

export function activeSinceOf(row: TemplateResourceRow): Temporal.Instant {
  return row.activeSince ?? row.modifiedAt ?? row.insertedAt;
}

export type ActiveInfo = { readonly version: number; readonly since: Temporal.Instant };

export type WorkingRow = TemplateResourceRow & { readonly active: ActiveInfo | null };

// A SystemAdmin edits system rows, so for them those rows count as their own.
function isSystemAdmin(user: { readonly roles: readonly string[] }): boolean {
  return user.roles.includes("SystemAdmin");
}

// A system row that was never served keeps its draft in the main fields, so only a SystemAdmin may read it.
export function isHiddenSystemDraft(
  user: { readonly roles: readonly string[] },
  row: Pick<TemplateResourceRow, "scope" | "status">,
): boolean {
  return row.scope === "system" && row.status === "draft" && !isSystemAdmin(user);
}

export function draftViewerTenantId(
  user: { readonly tenantId: string; readonly roles: readonly string[] },
  row: TemplateResourceRow,
): string {
  return row.scope === "system" && isSystemAdmin(user) ? row.tenantId : user.tenantId;
}

// The version an editor works on: the open draft if there is one, else the stored row.
// A draft is only shown to the tenant that owns the row, never through a system row.
export function toWorkingRow(row: TemplateResourceRow, viewerTenantId: string): WorkingRow {
  const active =
    row.status === "active" ? { version: activeVersionOf(row), since: activeSinceOf(row) } : null;
  const draft = row.tenantId === viewerTenantId ? parseTemplateDraft(row.draft) : null;
  // Saves and discards of drafts raise row.version; an editor without a draft shows the served number.
  if (draft === null) return { ...row, version: active?.version ?? row.version, active };
  return { ...row, ...draft, status: "draft", active };
}

// Event changes that turn a row into a served one. Every value is explicit so a
// rebuild reproduces the row without deriving anything.
export function servedStampChanges(row: { readonly version: number } | null) {
  return {
    activeVersion: row === null ? 1 : row.version + 1,
    activeSince: Temporal.Now.instant(),
  };
}

export function activeStampChanges(row: { readonly version: number } | null) {
  return { status: "active", ...servedStampChanges(row) };
}

// Publishing also consumes the open draft.
export function activationChanges(row: TemplateResourceRow | null) {
  return { ...activeStampChanges(row), draft: null };
}
