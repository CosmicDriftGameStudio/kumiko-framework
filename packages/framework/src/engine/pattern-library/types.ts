// Forms-Schema metadata — describes how a FeaturePattern is rendered as
// a Designer form, fed to an LLM as a JSON-Schema, or surfaced in the
// MCP-Server tool list. One schema, three consumers — that's the whole
// point of factoring this out of the hand-rolled C5 skeleton.
//
// **NOT a DSL.** The Source-of-Truth for a feature stays
// `defineFeature.ts` — the AST-visitor (feature-ast/parse.ts) reads it
// and the renderer (feature-ast/render.ts) writes it. This file is
// pure metadata for UI / LLM-prompt rendering: how to display the
// already-parsed FeaturePattern in a form. No alternative parser, no
// alternative syntax, no second canonical representation.
//
// **Vokabular** (12 input-types):
//
//   text                  — single-line string (name / label / id)
//   textarea              — multi-line string (description / SQL / readme)
//   number                — numeric (version / fromVersion / rateLimit.limit)
//   boolean               — checkbox (softDelete / default / openToAll)
//   select                — closed enum (idType / hookType / method)
//   string-list           — readonly string[] (featureNames / roles)
//   code-block            — opaque TS source-span, read-only in the form
//                            (schemaSource / handlerBody / fnBody)
//   entity-fields-editor  — per-row editor for EntityDefinition.fields
//   key-value-map         — generic { [key]: structured-value } editor
//                            (config.keys / translations.keys / applyBodies)
//   discriminated-union   — tagged sub-form (AccessRule: roles vs openToAll)
//   entity-ref            — string with autocomplete against the registry
//   json-readonly         — opaque pretty-printed JSON (Unknown / extension)
//
// **Path notation:** `path` references the value's location inside the
// FeaturePattern object using dot-separated keys (`definition.fields`,
// `access.roles`, `templates.email`). Numeric indices use the bracket
// form (`columns.0`). The Designer/LLM uses paths for read & write —
// the patcher (C2) consumes pattern-level updates only, so paths are
// purely a UI concern at this stage.

import type { FeaturePatternKind } from "../feature-ast/patterns";

// =============================================================================
// Field input types
// =============================================================================

export type FormInputType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "string-list"
  | "code-block"
  | "entity-fields-editor"
  | "key-value-map"
  | "discriminated-union"
  | "entity-ref"
  | "json-readonly";

// =============================================================================
// Field spec — one entry per editable property of a pattern
// =============================================================================

/**
 * Bilingual labels — Designer renders the user's locale, falls back to
 * `en`. AI-Builder uses `en` exclusively (cheaper prompts, single
 * grounding language for the model).
 */
export type FormFieldLabel = {
  readonly en: string;
  readonly de?: string;
};

/**
 * Common shape every field carries — the input-specific fields are added
 * by the discriminated subtypes below.
 */
type FormFieldBase = {
  /**
   * Dot/bracket-path inside the FeaturePattern. e.g. "entityName",
   * "definition.fields", "access.roles", "templates.email".
   */
  readonly path: string;
  readonly label: FormFieldLabel;
  /**
   * Short hint shown below the input. Optional — keep terse, the
   * Designer / LLM is the doc consumer, not the casual reader.
   */
  readonly hint?: FormFieldLabel;
  /**
   * Whether the form should refuse to submit when this field is empty.
   * Defaults to `false`. Validation runs *before* the patch hits the
   * file — caller-side guard.
   */
  readonly required?: boolean;
  /**
   * Read-only fields are surfaced for context but never edited (e.g.
   * `kind` discriminator, opaque source-spans on mixed patterns).
   */
  readonly readOnly?: boolean;
};

export type TextField = FormFieldBase & {
  readonly input: "text";
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly pattern?: string;
};

export type TextareaField = FormFieldBase & {
  readonly input: "textarea";
  readonly placeholder?: string;
  readonly rows?: number;
};

export type NumberField = FormFieldBase & {
  readonly input: "number";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
};

export type BooleanField = FormFieldBase & {
  readonly input: "boolean";
};

export type SelectOption = {
  readonly value: string;
  readonly label: FormFieldLabel;
};

export type SelectField = FormFieldBase & {
  readonly input: "select";
  readonly options: readonly SelectOption[];
};

export type StringListField = FormFieldBase & {
  readonly input: "string-list";
  /** Per-item placeholder, e.g. "feature-name". */
  readonly itemPlaceholder?: string;
};

export type CodeBlockField = FormFieldBase & {
  readonly input: "code-block";
  /**
   * The source language for syntax highlighting. The skeleton renders
   * everything as plain TS; later iterations can branch on `zod` /
   * `tsx` for dedicated highlighters.
   */
  readonly language: "typescript" | "tsx" | "zod";
};

/**
 * Editor for `EntityDefinition.fields` — a row per field with name,
 * type-discriminator, plus type-specific knobs. Modeled as a single
 * input-type because the structure is too rich for a generic
 * key-value-map (each row's right-hand side is itself a discriminated
 * union over FieldDefinition variants).
 */
export type EntityFieldsEditorField = FormFieldBase & {
  readonly input: "entity-fields-editor";
};

/**
 * Generic `{ [key]: value }` editor — value-shape is described by an
 * inner FormSchema applied to each entry. Used for config-keys,
 * translations, projection.applyBodies, notification.templates.
 */
export type KeyValueMapField = FormFieldBase & {
  readonly input: "key-value-map";
  /** Placeholder for new keys. */
  readonly keyPlaceholder?: string;
  /** What input renders for each value. Recursive — keep it simple. */
  readonly valueInput: FormInputType;
};

export type DiscriminatedUnionField = FormFieldBase & {
  readonly input: "discriminated-union";
  /** Tag-property name (e.g. "type" for hook-target, "kind" for relation). */
  readonly discriminator: string;
  /** Each branch carries its own field-list. */
  readonly variants: ReadonlyArray<{
    readonly tag: string;
    readonly label: FormFieldLabel;
    readonly fields: readonly FormFieldSpec[];
  }>;
};

export type EntityRefField = FormFieldBase & {
  readonly input: "entity-ref";
  /**
   * If true, the input also accepts cross-feature references like
   * `auth:event:loggedIn`. Default is feature-local only.
   */
  readonly allowQualified?: boolean;
};

export type JsonReadonlyField = FormFieldBase & {
  readonly input: "json-readonly";
};

export type FormFieldSpec =
  | TextField
  | TextareaField
  | NumberField
  | BooleanField
  | SelectField
  | StringListField
  | CodeBlockField
  | EntityFieldsEditorField
  | KeyValueMapField
  | DiscriminatedUnionField
  | EntityRefField
  | JsonReadonlyField;

// =============================================================================
// Pattern schema — top-level metadata for one FeaturePattern kind
// =============================================================================

/**
 * High-level grouping the Designer uses for navigation: data shapes
 * (entity / relation), behaviour (handler / hook), UI (screen / nav),
 * meta (config / metric / secret), background (job / projection),
 * cross-cutting (notification / authClaims / httpRoute), advanced
 * (extendsRegistrar / unknown). Order in the Designer panel is alpha
 * inside a category.
 */
export type PatternCategory =
  | "data"
  | "behaviour"
  | "ui"
  | "meta"
  | "background"
  | "cross-cutting"
  | "advanced";

export type PatternFormSchema = {
  readonly kind: FeaturePatternKind;
  readonly label: FormFieldLabel;
  /** Short blurb shown in the Designer's "add new pattern" dialog. */
  readonly summary: FormFieldLabel;
  readonly category: PatternCategory;
  /**
   * Editability matches feature-ast's `getEditability()`:
   *   - "static"  → fully form-driven, no closures
   *   - "mixed"   → header is form, body is opaque code-block
   *   - "opaque"  → entire pattern is read-only
   */
  readonly editability: "static" | "mixed" | "opaque";
  /**
   * Singleton kinds appear at most once per feature (requires,
   * toggleable, config, …). The Designer hides "Add" once the
   * singleton is present.
   */
  readonly singleton?: boolean;
  /** Ordered list of editable fields. */
  readonly fields: readonly FormFieldSpec[];
};
