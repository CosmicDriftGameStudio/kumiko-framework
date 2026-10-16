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

export function activeSinceOf(row: TemplateResourceRow): Temporal.Instant {
  return row.activeSince ?? row.modifiedAt ?? row.insertedAt;
}

export type ActiveInfo = { readonly version: number; readonly since: Temporal.Instant };

export type WorkingRow = TemplateResourceRow & { readonly active: ActiveInfo | null };

// The version an editor works on: the open draft if there is one, else the stored row.
export function toWorkingRow(row: TemplateResourceRow): WorkingRow {
  const active =
    row.status === "active" ? { version: activeVersionOf(row), since: activeSinceOf(row) } : null;
  const draft = parseTemplateDraft(row.draft);
  // Saves and discards of drafts raise row.version; an editor without a draft shows the served number.
  if (draft === null) return { ...row, version: active?.version ?? row.version, active };
  return { ...row, ...draft, status: "draft", active };
}

// Event changes that turn a row into a served one. Every value is explicit so a
// rebuild reproduces the row without deriving anything.
export function activationChanges(row: TemplateResourceRow | null) {
  return {
    status: "active",
    draft: null,
    activeVersion: row === null ? 1 : row.version + 1,
    activeSince: Temporal.Now.instant(),
  };
}
