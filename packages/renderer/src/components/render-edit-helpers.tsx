import type {
  EntityEditScreenDefinition,
  FieldCondition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  isFieldsEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type * as z from "zod";
import type {
  EditSectionViewModel,
  FieldConditions,
  FormValues,
  Translate,
} from "../headless/index.ts";
import { relevantFieldIssues, zodErrorToFieldIssues } from "../headless/index.ts";

// End-to-end renderer for an entityEdit screen. Renders exclusively
// through primitives, no raw HTML. A native renderer that fills the same
// primitives registry gets the form without further changes.

function toConditionValue<TValues extends FormValues, TCtx>(
  cond: FieldCondition,
): NonNullable<FieldConditions<TValues, TCtx>["visible"]> {
  if (typeof cond === "boolean") return cond;
  // @cast-boundary form-values: TValues is structurally a record.
  return (values: TValues) => evalFieldCondition(cond, values as Record<string, unknown>);
}

// Tab-strip key. The boot-validator makes `id` mandatory on a tabs layout and
// entityEdit only ever has "fields"/"extension" sections (relatedList and
// writeForm are rejected outright), so the positional fallback is unreachable
// for a tabs screen — it only keeps this total for other layouts.
export function tabIdAt(section: EditSectionViewModel | undefined, index: number): string {
  const declared =
    section?.kind === "fields" || section?.kind === "extension" ? section.id : undefined;
  return declared ?? `section-${index}`;
}

export function deriveFormFields<TValues extends FormValues, TCtx>(
  screen: EntityEditScreenDefinition,
): Record<string, FieldConditions<TValues, TCtx>> {
  const out: Record<string, FieldConditions<TValues, TCtx>> = {};
  for (const section of screen.layout.sections) {
    // relatedList carries no `fields` for the form-condition map either.
    if (!isFieldsEditSection(section)) continue;
    for (const spec of sectionFieldSpecs(section)) {
      const normalized = normalizeEditField(spec);
      out[normalized.field] = {
        ...(normalized.visible !== undefined && {
          visible: toConditionValue<TValues, TCtx>(normalized.visible),
        }),
        ...(normalized.readOnly !== undefined && {
          readonly: toConditionValue<TValues, TCtx>(normalized.readOnly),
        }),
        ...(normalized.required !== undefined && {
          required: toConditionValue<TValues, TCtx>(normalized.required),
        }),
      };
    }
  }
  return out;
}

type FieldsSectionViewModel = Extract<EditSectionViewModel, { readonly kind: "fields" }>;

type DryRunSnapshot = {
  readonly values: unknown;
  readonly fields: Readonly<Record<string, { readonly visible: boolean }>>;
};

type DryRunParse = {
  readonly issues: ReturnType<typeof zodErrorToFieldIssues>;
  readonly hiddenFields: ReadonlySet<string>;
};

// Dry-run parse against `schema` — NOT controller.validate(), which writes
// field errors into the snapshot. Undefined when the values parse cleanly.
// Parse once, then narrow per scope with scopedDryRunIssues: the wizard step
// check would otherwise re-parse the whole form per section on every keystroke.
export function dryRunParse(schema: z.ZodType, snapshot: DryRunSnapshot): DryRunParse | undefined {
  const parsed = schema.safeParse(snapshot.values);
  if (parsed.success) return undefined;
  const hiddenFields = new Set(
    Object.entries(snapshot.fields)
      .filter(([, state]) => !state.visible)
      .map(([fieldKey]) => fieldKey),
  );
  return { issues: zodErrorToFieldIssues(parsed.error), hiddenFields };
}

// Issues are filtered exactly like the controller's validate(): hidden
// fields never count, `scope` narrows.
function scopedDryRunIssues(
  parse: DryRunParse | undefined,
  scope: readonly string[] | undefined,
  includeRoot: boolean,
): ReturnType<typeof relevantFieldIssues> {
  if (parse === undefined) return [];
  return relevantFieldIssues(parse.issues, {
    hiddenFields: parse.hiddenFields,
    ...(scope !== undefined && { scope }),
    includeRoot,
  });
}

export function dryRunFieldIssues(
  schema: z.ZodType,
  snapshot: DryRunSnapshot,
  scope: readonly string[] | undefined,
  includeRoot: boolean,
): ReturnType<typeof relevantFieldIssues> {
  return scopedDryRunIssues(dryRunParse(schema, snapshot), scope, includeRoot);
}

// Index-independent: indices shift when a fields section hides.
export function wizardStepKey(section: EditSectionViewModel, index: number): string {
  const declaredId =
    section.kind === "fields" || section.kind === "extension" ? section.id : undefined;
  return declaredId ?? section.title ?? `step-${index}`;
}

function isMoneyValue(value: unknown): value is { readonly amount: unknown } {
  return typeof value === "object" && value !== null && "amount" in value;
}

// The seeds buildInitialValues writes for NULL columns of an existing record.
function isEmptyFormValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "" || value === 0 || value === false) {
    return true;
  }
  if (Array.isArray(value)) return value.length === 0;
  return isMoneyValue(value) && value.amount === 0;
}

// select/boolean are excluded from the "holds user data" check: they are
// often pre-filled (defaults, server-set values), so they say nothing about
// whether the step was filled in. They still count through the validation.
export function isFieldsStepFilled(
  section: FieldsSectionViewModel,
  parse: DryRunParse | undefined,
): boolean {
  const fieldNames = section.fields.map((f) => f.field);
  if (scopedDryRunIssues(parse, fieldNames, false).length > 0) return false;
  return section.fields.some(
    (f) =>
      f.visible &&
      !f.readOnly &&
      f.type !== "boolean" &&
      f.type !== "select" &&
      !isEmptyFormValue(f.value),
  );
}

export type FormErrorSource = "submit" | "delete";

export function formSectionDomId(sectionIndex: number): string {
  return `form-section-${sectionIndex}`;
}

/** A record title is a non-blank string; anything else leaves the screen title alone. */
export function resolveRecordTitle(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

const TITLE_PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

// Falls back to the plain title while any placeholder value is still empty,
// so the header never shows "Add  " mid-typing.
export function resolveTitleTemplate(
  template: string | undefined,
  values: FormValues,
  translate: Translate,
  fallback: string,
): string {
  if (template === undefined) return fallback;
  const placeholders = [...translate(template).matchAll(TITLE_PLACEHOLDER_PATTERN)].map(
    (match) => match[1] ?? "",
  );
  const isFilled = (name: string): boolean => {
    const value = values[name];
    return value !== undefined && value !== null && String(value).trim() !== "";
  };
  if (!placeholders.every(isFilled)) return fallback;
  return translate(template, values);
}
