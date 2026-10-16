import type { Registry, TemplateVariables } from "@cosmicdrift/kumiko-framework/engine";
import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  CONTENT_FORMATS,
  type ContentFormat,
  TEMPLATE_KINDS,
  type TemplateKind,
} from "../constants.js";
import { documentViolationsToFieldIssues } from "../document-sanitizer.js";
import { sanitizeTemplateWriteBody, type TemplateWriteScope } from "../layout-regions.js";
import { imageResourceKeysOf } from "../linked-resources.js";
import type { TemplateResourceRow } from "../table.js";
import { parseTemplateMeta, type TemplateMetaIssue } from "../template-meta.js";
import {
  resolveTemplateVariables,
  type TemplateValidation,
  validateTemplatePlaceholders,
} from "../template-validation.js";

const PLACEHOLDER_VALIDATED_KINDS: ReadonlySet<TemplateKind> = new Set([
  "mail",
  "document-pdf",
  "pdf-layout",
]);

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

export type TemplateWriteInput = {
  readonly kind: TemplateKind;
  readonly scope: TemplateWriteScope;
  readonly contentFormat: ContentFormat;
  readonly content: string | null;
  readonly rawMeta: unknown;
  readonly variables: TemplateVariables;
  /** Keys with an uploaded file besides the built-in `logo`; only feeds the unknownResources warning. */
  readonly resourceKeys?: readonly string[];
};

export type TemplateWriteResult =
  | {
      readonly ok: true;
      readonly content: string | null;
      readonly metaJson: string | null;
      readonly validation: TemplateValidation | null;
      /** Problems that still allow a draft but block publishing. */
      readonly publishIssues: readonly FieldIssue[];
    }
  | {
      readonly ok: false;
      readonly issues: readonly FieldIssue[];
      /** Set when the placeholder scan ran, so callers can still list what it found. */
      readonly validation: TemplateValidation | null;
    };

const NO_PUBLISH_ISSUES: readonly FieldIssue[] = [];

function isPlaceholderValidated(kind: TemplateKind, contentFormat: ContentFormat): boolean {
  if (kind === "mail-layout") return contentFormat === "html";
  return PLACEHOLDER_VALIDATED_KINDS.has(kind);
}

// The single validation pipeline of every template write: sanitize and layout
// rules, then meta, then placeholders.
export function evaluateTemplateWrite(input: TemplateWriteInput): TemplateWriteResult {
  const body = sanitizeTemplateWriteBody({
    kind: input.kind,
    scope: input.scope,
    contentFormat: input.contentFormat,
    content: input.content,
  });
  if (!body.ok)
    return {
      ok: false,
      issues: documentViolationsToFieldIssues(body.violations),
      validation: null,
    };

  const parsedMeta = parseTemplateMeta(input.kind, input.rawMeta);
  if (!parsedMeta.ok) {
    return { ok: false, issues: parsedMeta.issues.map(metaIssueToFieldIssue), validation: null };
  }
  const metaJson = parsedMeta.meta === null ? null : JSON.stringify(parsedMeta.meta);
  if (!isPlaceholderValidated(input.kind, input.contentFormat)) {
    return {
      ok: true,
      content: body.content,
      metaJson,
      validation: null,
      publishIssues: NO_PUBLISH_ISSUES,
    };
  }

  const validation = validateTemplatePlaceholders({
    kind: input.kind,
    body: body.content ?? "",
    meta: parsedMeta.meta,
    variables: input.variables,
    resourceKeys: input.resourceKeys,
  });
  const issues = placeholderIssues(validation, { requireAllRequired: false });
  if (issues.length > 0) return { ok: false, issues, validation };
  return {
    ok: true,
    content: body.content,
    metaJson,
    validation,
    publishIssues: placeholderIssues(validation, { requireAllRequired: true }),
  };
}

function isTemplateKind(kind: string): kind is TemplateKind {
  return isOneOf(TEMPLATE_KINDS, kind);
}

export function parseStoredJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function isGatedKind(kind: string): kind is TemplateKind {
  return isTemplateKind(kind) && (kind === "mail-layout" || PLACEHOLDER_VALIDATED_KINDS.has(kind));
}

export function storedRecord(raw: string | null): Readonly<Record<string, unknown>> {
  const parsed = parseStoredJson(raw);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

// Publishing makes a row servable, so a stored row must pass the same pipeline
// as an active write would have.
export function publishGateIssues(
  registry: Registry,
  row: TemplateResourceRow,
): readonly FieldIssue[] {
  if (!isGatedKind(row.kind) || !isOneOf(CONTENT_FORMATS, row.contentFormat)) return [];
  const result = evaluateTemplateWrite({
    kind: row.kind,
    scope: row.scope === "system" ? "system" : "tenant",
    contentFormat: row.contentFormat,
    content: row.content,
    rawMeta: parseStoredJson(row.meta),
    variables: resolveTemplateVariables(registry, row.slug, storedRecord(row.variableSchema)),
    resourceKeys: imageResourceKeysOf(row.linkedResources),
  });
  return result.ok ? result.publishIssues : result.issues;
}
