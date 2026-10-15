import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { TEMPLATE_KINDS, type TemplateKind } from "../constants.js";
import type { TemplateResourceRow } from "../table.js";
import { parseTemplateMeta, type TemplateMeta, type TemplateMetaIssue } from "../template-meta.js";
import {
  resolveTemplateVariables,
  type TemplateValidation,
  validateTemplatePlaceholders,
} from "../template-validation.js";

const PLACEHOLDER_VALIDATED_KINDS: ReadonlySet<TemplateKind> = new Set(["mail"]);

export function isPlaceholderValidatedKind(kind: TemplateKind): boolean {
  return PLACEHOLDER_VALIDATED_KINDS.has(kind);
}

function metaIssueToFieldIssue(issue: TemplateMetaIssue): FieldIssue {
  return {
    path: issue.path,
    code: "invalid_meta",
    i18nKey: "templateResolver.errors.template.invalidMeta",
    params: { detail: issue.message },
  };
}

export function placeholderIssues(
  validation: TemplateValidation,
  opts: { readonly requireAllRequired: boolean },
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (validation.unknown.length > 0) {
    issues.push({
      path: "content",
      code: "unknown_placeholder",
      i18nKey: "templateResolver.errors.template.unknownPlaceholders",
      params: { detail: validation.unknown.join(", ") },
    });
  }
  if (opts.requireAllRequired && validation.missingRequired.length > 0) {
    issues.push({
      path: "content",
      code: "missing_required_placeholder",
      i18nKey: "templateResolver.errors.template.missingRequiredPlaceholders",
      params: { detail: validation.missingRequired.join(", ") },
    });
  }
  return issues;
}

export type TemplateGateInput = {
  readonly registry: Registry;
  readonly slug: string;
  readonly kind: TemplateKind;
  readonly content: string | null;
  readonly rawMeta: unknown;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  /** upsert-system and active tenant writes need every required variable used;
   *  a tenant draft may still be incomplete. */
  readonly requireAllRequired: boolean;
};

export type TemplateGateResult =
  | {
      readonly ok: true;
      readonly metaJson: string | null;
      readonly validation: TemplateValidation | null;
    }
  | { readonly ok: false; readonly issues: readonly FieldIssue[] };

export function runTemplateGates(input: TemplateGateInput): TemplateGateResult {
  const parsedMeta = parseTemplateMeta(input.kind, input.rawMeta);
  if (!parsedMeta.ok) return { ok: false, issues: parsedMeta.issues.map(metaIssueToFieldIssue) };
  const metaJson = parsedMeta.meta === null ? null : JSON.stringify(parsedMeta.meta);
  if (!isPlaceholderValidatedKind(input.kind)) return { ok: true, metaJson, validation: null };

  const validation = validatePlaceholders({
    registry: input.registry,
    slug: input.slug,
    content: input.content,
    meta: parsedMeta.meta,
    variableSchema: input.variableSchema,
  });
  const issues = placeholderIssues(validation, { requireAllRequired: input.requireAllRequired });
  return issues.length > 0 ? { ok: false, issues } : { ok: true, metaJson, validation };
}

export function validatePlaceholders(input: {
  readonly registry: Registry;
  readonly slug: string;
  readonly content: string | null;
  readonly meta: TemplateMeta | null;
  readonly variableSchema: Readonly<Record<string, unknown>>;
}): TemplateValidation {
  return validateTemplatePlaceholders({
    body: input.content ?? "",
    meta: input.meta,
    variables: resolveTemplateVariables(input.registry, input.slug, input.variableSchema),
  });
}

function isTemplateKind(kind: string): kind is TemplateKind {
  return (TEMPLATE_KINDS as readonly string[]).includes(kind);
}

function parseStoredJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// Publishing makes a row servable, so a stored mail row must be as complete as
// an active write would have required.
export function publishGateIssues(
  registry: Registry,
  row: TemplateResourceRow,
): readonly FieldIssue[] {
  if (!isTemplateKind(row.kind) || !isPlaceholderValidatedKind(row.kind)) return [];
  const parsedMeta = parseTemplateMeta(row.kind, parseStoredJson(row.meta));
  if (!parsedMeta.ok) return parsedMeta.issues.map(metaIssueToFieldIssue);
  const variableSchema = parseStoredJson(row.variableSchema);
  const validation = validatePlaceholders({
    registry,
    slug: row.slug,
    content: row.content,
    meta: parsedMeta.meta,
    variableSchema:
      typeof variableSchema === "object" &&
      variableSchema !== null &&
      !Array.isArray(variableSchema)
        ? Object.fromEntries(Object.entries(variableSchema))
        : {},
  });
  return placeholderIssues(validation, { requireAllRequired: true });
}
