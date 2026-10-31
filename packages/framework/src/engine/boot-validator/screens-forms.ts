import type {
  EntityDefinition,
  FieldDefinition,
  OptionsQueryPayload,
} from "@cosmicdrift/kumiko-types/fields";
import { NO_WIDGET_FIELD_TYPES, optionsQueryFieldRefs } from "@cosmicdrift/kumiko-types/fields";
import { isKebabSegment } from "../qualified-name.ts";
import type { FieldsOrGroupsSection } from "../screen-helpers.ts";
import {
  isExtensionEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "../screen-helpers.ts";
import type { FeatureDefinition } from "../types/index.ts";

import type {
  ActionFormScreenDefinition,
  ActionFormSuccessLink,
  ConfigEditScreenDefinition,
  EditFieldSpec,
  EditLayout,
  SecretMintScreenDefinition,
} from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { validateFormDerivations, validateFormDerivationsEnforced } from "./form-derivations.ts";
import type { NavigateTargetLookups } from "./screens-actions.ts";
import {
  assertWriteHandlerRegistered,
  isSensitiveOrPasswordField,
  validateIdlessSuccessLink,
  validateRedirectTarget,
  validateScreenNavTarget,
} from "./screens-actions.ts";
import { SCREEN_ACTION_RULES } from "./screens-actions-rules.ts";
import { FORM_LAYOUT_RULES } from "./screens-forms-layout-rules.ts";
import { FORM_FIELD_RULES } from "./screens-forms-rules.ts";

function assertKnownSubFields(
  where: string,
  option: string,
  cells: readonly string[] | undefined,
  schema: Readonly<Record<string, unknown>>,
): void {
  for (const cell of cells ?? []) {
    if (schema[cell] === undefined) {
      throw bootRuleError(FORM_FIELD_RULES.embeddedListUnknownSubField, {
        message:
          `${where} embeddedList.${option} names "${cell}", which is not a sub-field ` +
          `(known: ${Object.keys(schema).sort().join(", ")}).`,
      });
    }
  }
}

function assertCardHiddenCellsReadOnly(
  where: string,
  cardHiddenCells: readonly string[] | undefined,
  readOnlyCells: readonly string[] | undefined,
): void {
  for (const cell of cardHiddenCells ?? []) {
    if (readOnlyCells?.includes(cell) !== true) {
      throw bootRuleError(FORM_FIELD_RULES.embeddedListCardHiddenEditable, {
        message:
          `${where} embeddedList.cardHiddenCells names "${cell}", which is editable; ` +
          `only read-only cells (readOnlyCells) can be hidden on cards, otherwise phone users cannot fill it.`,
      });
    }
  }
}

// A field type in NO_WIDGET_FIELD_TYPES renders read-only on the auto-wired
// entityEdit path — a required field the user can never fill would
// block every save. Only the statically-resolvable case is caught here: a
// literal `required: true` (screen-spec override or entity-level default).
// A dynamic FieldCondition depends on runtime form values and can't be
// evaluated at boot; buildFormSchema() silently skips presence-checking it.
// `embeddedList` and `prefill` only make sense on field types that support them;
// a misplaced spec would otherwise be a silent no-op.
export function validateEditFieldExtras(
  featureName: string,
  screenId: string,
  entityDef: EntityDefinition,
  fieldSpec: Exclude<EditFieldSpec, string>,
): void {
  const fieldDef = entityDef.fields[fieldSpec.field];
  // skip: the field name is not on the entity, other checks report unknown fields
  if (fieldDef === undefined) return;
  const where = `[Feature ${featureName}] Screen "${screenId}" (entityEdit) field "${fieldSpec.field}"`;
  const listSpec = fieldSpec.embeddedList;
  if (listSpec !== undefined) {
    if (fieldDef.type !== "embedded" || fieldDef.multiple !== true) {
      throw bootRuleError(FORM_FIELD_RULES.embeddedListOnNonListField, {
        message:
          `${where} sets embeddedList, which only applies to an embedded list ` +
          `(createEmbeddedListField); the field is type "${fieldDef.type}". Remove embeddedList or point it at an embedded list field.`,
      });
    }
    assertKnownSubFields(where, "readOnlyCells", listSpec.readOnlyCells, fieldDef.schema);
    assertKnownSubFields(where, "cardHiddenCells", listSpec.cardHiddenCells, fieldDef.schema);
    assertCardHiddenCellsReadOnly(where, listSpec.cardHiddenCells, listSpec.readOnlyCells);
  }
  const prefill = fieldSpec.prefill;
  // skip: no prefill declared
  if (prefill === undefined) return;
  if (prefill.kind === "today") {
    if (fieldDef.type !== "date") {
      throw bootRuleError(FORM_FIELD_RULES.prefillTodayNeedsDate, {
        message: `${where} prefill "today" needs a date field; the field is type "${fieldDef.type}". Use a date field or a different prefill.`,
      });
    }
    // skip: today carries no property, nothing further to check
    return;
  }
  const allowsUserId = fieldDef.type === "text" || fieldDef.type === "reference";
  if (prefill.property === "id" ? !allowsUserId : fieldDef.type !== "text") {
    throw bootRuleError(FORM_FIELD_RULES.prefillCurrentUserFieldType, {
      message:
        `${where} prefill currentUser.${prefill.property} does not fit a field of type ` +
        `"${fieldDef.type}" (displayName and email need text; id needs text or a reference). Use a fitting field type or a different prefill property.`,
    });
  }
}

// `{ field }` affixes and fillAction params read live form values, so every
// name must be a field of the same form — a typo would otherwise render no
// affix or send an undefined param without a hint.
export function validateFieldFormRefs(
  where: string,
  fieldSpec: Exclude<EditFieldSpec, string>,
  formFieldNames: ReadonlySet<string>,
): void {
  const affixes = [
    ["prefix", fieldSpec.prefix],
    ["suffix", fieldSpec.suffix],
  ] as const;
  for (const [prop, affix] of affixes) {
    if (affix === undefined || typeof affix === "string") continue;
    if (!formFieldNames.has(affix.field)) {
      throw bootRuleError(FORM_FIELD_RULES.affixUnknownField, {
        message: `${where} ${prop} references unknown field "${affix.field}" — it must be another field of the same form.`,
      });
    }
  }
  const params = fieldSpec.fillAction?.params;
  // skip: no fill-action params to cross-check
  if (params === undefined) return;
  const sourceFields = "pick" in params ? params.pick : Object.values(params.map);
  for (const sourceField of sourceFields) {
    if (!formFieldNames.has(sourceField)) {
      throw bootRuleError(FORM_FIELD_RULES.fillActionUnknownField, {
        message: `${where} fillAction.params reads unknown field "${sourceField}" — it must be a field of the same form.`,
      });
    }
  }
}

const FILL_ACTION_FIELD_TYPES: readonly string[] = ["text", "number", "decimal", "bigInt"];

// The fill button writes a plain text or numeric query result into the field;
// a secret value must never be filled from a query response.
export function validateFillActionTarget(
  where: string,
  fieldSpec: Exclude<EditFieldSpec, string>,
  fieldDef: { readonly type: string } | undefined,
): void {
  // skip: no fill action, or the field is unknown (reported elsewhere)
  if (fieldSpec.fillAction === undefined || fieldDef === undefined) return;
  if (!FILL_ACTION_FIELD_TYPES.includes(fieldDef.type)) {
    throw bootRuleError(FORM_FIELD_RULES.fillActionFieldType, {
      message:
        `${where} fillAction needs a ${FILL_ACTION_FIELD_TYPES.join(", ")} field, not "${fieldDef.type}". ` +
        `Remove fillAction or use a fitting field type.`,
    });
  }
  if (isSensitiveOrPasswordField(fieldDef)) {
    throw bootRuleError(FORM_FIELD_RULES.fillActionSensitiveField, {
      message:
        `${where} fillAction targets a sensitive, writeOnly or password field — a query result is ` +
        `never written into those. Remove fillAction.`,
    });
  }
}

export function validateNoWidgetRequiredField(
  featureName: string,
  screenId: string,
  entityDef: EntityDefinition,
  fieldSpec: Exclude<EditFieldSpec, string>,
): void {
  const fieldDef = entityDef.fields[fieldSpec.field];
  // skip: field doesn't exist or its type already has a widget — nothing to validate.
  if (fieldDef === undefined || !NO_WIDGET_FIELD_TYPES.includes(fieldDef.type)) return;
  // Embedded LIST fields (`multiple: true`) get their own EmbeddedListField
  // grid widget — only plain (non-list) embedded has no widget.
  const isEmbeddedList = fieldDef.type === "embedded" && fieldDef.multiple === true;
  // skip: list variant has a widget — not the no-widget case this guard targets.
  if (isEmbeddedList) return;
  // skip: already read-only by spec — no fillable widget needed regardless of type.
  if (fieldSpec.readOnly === true) return;
  const entityRequired = "required" in fieldDef && fieldDef.required === true;
  const isStaticallyRequired =
    fieldSpec.required === undefined ? entityRequired : fieldSpec.required === true;
  // skip: not required — a read-only widget-less field is fine to leave empty.
  if (!isStaticallyRequired) return;
  throw bootRuleError(FORM_FIELD_RULES.requiredFieldWithoutWidget, {
    message:
      `[Feature ${featureName}] Screen "${screenId}" (entityEdit) field "${fieldSpec.field}" is ` +
      `type "${fieldDef.type}", which renders read-only on the auto-wired entityEdit path — a ` +
      `required field the user could never fill would block every save. Set required: false, ` +
      `move the field to a custom-component section, or drop the required constraint.`,
  });
}

// Shared by projectionDetail and entityEdit: a tab strip needs something to
// label each tab with and a stable id per tab — the id anchors the ?tab=
// param on projectionDetail and the jump-to-erroring-tab logic on entityEdit.
export function validateTabSections(
  featureName: string,
  screenId: string,
  screenType: "projectionDetail" | "entityEdit",
  sections: readonly { readonly id?: string; readonly title?: string }[],
): void {
  if (sections.length < 2) {
    throw bootRuleError(FORM_LAYOUT_RULES.tabsTooFewSections, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "tabs" but only ` +
        `${sections.length} section(s) — tabs need at least 2 sections.`,
    });
  }
  const tabIds = new Set<string>();
  sections.forEach((section, index) => {
    if (section.title === undefined || section.title.trim().length === 0) {
      throw bootRuleError(FORM_LAYOUT_RULES.tabTitleMissing, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "tabs" but ` +
          `sections[${index}] has no title — every tab needs a title.`,
      });
    }
    if (section.id === undefined || section.id.trim().length === 0) {
      throw bootRuleError(FORM_LAYOUT_RULES.tabIdMissing, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "tabs" but ` +
          `sections[${index}] ("${section.title}") has no id — every tab needs a stable id.`,
      });
    }
    if (!isKebabSegment(section.id)) {
      throw bootRuleError(FORM_LAYOUT_RULES.tabIdNotKebab, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sections[${index}] ` +
          `("${section.title}") has id "${section.id}" — must be kebab-case.`,
      });
    }
    if (tabIds.has(section.id)) {
      throw bootRuleError(FORM_LAYOUT_RULES.tabIdDuplicate, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has duplicate tab id ` +
          `"${section.id}" (sections[${index}]). Give each tab section a unique id.`,
      });
    }
    tabIds.add(section.id);
  });
}

// Wizard layouts (mode: "wizard") need >= 2 titled sections — a single or
// untitled step would leave the progress indicator blank, so both fail at
// boot rather than as a broken step UI.
export function validateWizardLayout(
  featureName: string,
  screenId: string,
  screenType: "entityEdit" | "actionForm" | "configEdit" | "secretMint",
  layout: EditLayout,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // entityEdit renders tabs like wizard steps: every section stays mounted,
  // submit validates across all of them, and a field error jumps to the tab
  // holding it. The other three have no such jump — actionForm and
  // secretMint are one-shot forms, configEdit fires a write per field — so a
  // required field on a hidden tab would still block their submit silently.
  if (layout.mode === "tabs") {
    if (screenType !== "entityEdit") {
      throw bootRuleError(FORM_LAYOUT_RULES.tabsUnsupportedScreenType, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sets mode: "tabs" — tabs are only ` +
          `supported on projectionDetail and entityEdit. Use mode: "wizard" or "single" instead.`,
      });
    }
    validateTabSections(featureName, screenId, screenType, layout.sections);
  }
  // "form-draft" is hardcoded because the framework layer must not depend on
  // @cosmicdrift/kumiko-bundled-features — same precedence as the
  // "user-data-rights" check in gdpr-storage.ts.
  if (layout.draft === true) {
    if (layout.mode !== "wizard") {
      throw bootRuleError(FORM_LAYOUT_RULES.draftWithoutWizard, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sets draft: true but ` +
          `mode is not "wizard" — draft persistence only applies to wizard layouts. Remove ` +
          `draft: true or set mode: "wizard".`,
      });
    }
    if (!featureMap.has("form-draft")) {
      throw bootRuleError(FORM_LAYOUT_RULES.draftFeatureMissing, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sets draft: true but the ` +
          `bundled feature "form-draft" is not mounted — every resume would silently lose its ` +
          `values. Add createFormDraftFeature() from @cosmicdrift/kumiko-bundled-features to the app's ` +
          `feature list.`,
      });
    }
  }
  // skip: mode omitted/"single" — no wizard constraints apply.
  if (layout.mode !== "wizard") return;
  if (layout.sections.length < 2) {
    throw bootRuleError(FORM_LAYOUT_RULES.wizardTooFewSections, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "wizard" but only ` +
        `${layout.sections.length} section(s) — a wizard needs at least 2 sections (one per step).`,
    });
  }
  layout.sections.forEach((section, index) => {
    if (section.title === undefined || section.title.trim().length === 0) {
      throw bootRuleError(FORM_LAYOUT_RULES.wizardStepTitleMissing, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "wizard" but ` +
          `sections[${index}] has no title — every wizard step needs a title.`,
      });
    }
  });
}

// --- Screen validation ---
//
// For every r.screen() declaration check what's locally knowable at boot:
//   - entityList / entityEdit: the referenced entity must exist in the
//     feature (cross-feature entity-refs aren't allowed — a feature owns
//     the screens over its own entities) and every column/field ref must
//     name a real field on that entity
//   - custom: the renderer must at least have one platform component set
//     (react OR native), otherwise the screen is structurally empty
//
// Field-level renderer QN strings (cross-feature `component:` references)
// are NOT validated here — the r.uiComponent registry that would resolve
// them ships later. Until then those are kept opaque on purpose.

// Shared by the mint step's own handler (screen.handler) and its optional
// confirm step (confirm.handler) — both are a bare write-handler QN with the
// same registration requirement.
function validateWriteHandlerRegistered(
  featureName: string,
  screenId: string,
  context: string,
  handler: unknown,
  allWriteHandlerQns: ReadonlySet<string>,
): void {
  if (!handler || typeof handler !== "string") {
    throw bootRuleError(FORM_FIELD_RULES.handlerEmpty, {
      message: `[Feature ${featureName}] Screen "${screenId}" (${context}) has empty or non-string handler. Set handler to a non-empty handler name.`,
    });
  }
  assertWriteHandlerRegistered(
    featureName,
    `Screen "${screenId}" (${context})`,
    handler,
    allWriteHandlerQns,
  );
}

// Every field entry must carry a `type` discriminator. An author typo
// (`title: { required: true }` without a type) would otherwise let
// RenderField silently fall through to the default renderer and submit an
// empty string — failing at boot is clearer. `type as unknown` because
// FieldDefinition, as a union, only allows known type strings; here we're
// checking author code that may have circumvented the type check.
//
// Parametrized over (fields, layout) instead of a whole screen so a
// secretMint's own `confirm` step — a second, independent inline form on the
// same screen — can reuse the same checks as its `fields`/`layout` pair.
// `allowEmpty` is only ever true for a secretMint's own mint step (an
// input-less mint): the secret is server-generated and the mint
// step is just its submit button — actionForm and the confirm step always
// require at least one field.
function validateFormFieldsMap(
  featureName: string,
  screenId: string,
  context: string,
  fields: Readonly<Record<string, FieldDefinition>>,
  allowEmpty: boolean,
): Set<string> {
  const fieldNames = new Set(Object.keys(fields));
  if (fieldNames.size === 0 && !allowEmpty) {
    throw bootRuleError(FORM_FIELD_RULES.fieldsEmpty, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (${context}) has empty fields map — ` +
        `declare at least one field.`,
    });
  }
  for (const [fname, fdef] of Object.entries(fields)) {
    // @cast-boundary schema-walk — feature-config inspection (Author may circumvent type-check)
    const ftype = (fdef as { type?: unknown }).type;
    if (typeof ftype !== "string" || ftype.length === 0) {
      throw bootRuleError(FORM_FIELD_RULES.fieldTypeMissing, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${context}) field "${fname}" has no ` +
          `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
      });
    }
    if (ftype === "money") {
      validateFormMoneyCurrency(featureName, screenId, context, fname, fdef);
    }
    validateFormSelectOptions(featureName, screenId, context, fname, fdef, fieldNames);
    rejectWriteOnlyFormField(featureName, screenId, context, fname, fdef);
  }
  return fieldNames;
}

function validateOptionsQueryFieldRefs(
  where: string,
  fieldName: string,
  payload: OptionsQueryPayload | undefined,
  siblingFieldNames: ReadonlySet<string>,
): void {
  for (const ref of optionsQueryFieldRefs(payload)) {
    if (ref === fieldName) {
      throw bootRuleError(FORM_FIELD_RULES.optionsQueryPayloadSelfReference, {
        message: `${where} optionsQueryPayload references itself ({ field: "${ref}" }). Reference a different field of the form.`,
      });
    }
    if (!siblingFieldNames.has(ref)) {
      throw bootRuleError(FORM_FIELD_RULES.optionsQueryPayloadUnknownField, {
        message: `${where} optionsQueryPayload references unknown field "${ref}" — it must be another field of the same form`,
      });
    }
  }
}

export function isWriteOnlyField(fdef: FieldDefinition | undefined): boolean {
  return (fdef as { writeOnly?: unknown } | undefined)?.writeOnly === true; // @cast-boundary schema-walk
}

// A secret on a configEdit form keeps its value out of the client like an encrypted
// config key does. The secrets store only exists per tenant and, for scope "system", platform-wide
// under the system tenant.
export function validateConfigEditSecretField(
  featureName: string,
  screen: ConfigEditScreenDefinition,
  fieldName: string,
  secretQn: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const where = `[Feature ${featureName}] Screen "${screen.id}" (configEdit) field "${fieldName}"`;
  if (screen.configKeys[fieldName] !== undefined) {
    throw bootRuleError(FORM_FIELD_RULES.configSecretAlsoConfigKey, {
      message: `${where} is mapped in both configKeys and secretKeys — keep one.`,
    });
  }
  if (screen.scope === "user") {
    throw bootRuleError(FORM_FIELD_RULES.configSecretScope, {
      message: `${where} maps secret "${secretQn}" on a user-scope screen — secrets exist per tenant or platform-wide (scope "system"), not per user.`,
    });
  }
  const fdef = screen.fields[fieldName];
  if (fdef?.type !== "text" || !isWriteOnlyField(fdef)) {
    throw bootRuleError(FORM_FIELD_RULES.configSecretFieldType, {
      message: `${where} maps secret "${secretQn}" but is no writeOnly text field — a stored secret never goes back to the client.`,
    });
  }
  const declared = [...featureMap.values()].some((feature) =>
    Object.values(feature.secretKeys ?? {}).some((def) => def.qualifiedName === secretQn),
  );
  if (!declared) {
    throw bootRuleError(FORM_FIELD_RULES.configSecretUndeclared, {
      message: `${where} → secret "${secretQn}" is not declared via r.secret() in any feature.`,
    });
  }
}

// Inline forms have no stored value to hide or keep: writeOnly there would
// render a "set / keep" affordance with nothing behind it.
export function rejectWriteOnlyFormField(
  featureName: string,
  screenId: string,
  context: string,
  fieldName: string,
  fdef: FieldDefinition,
): void {
  if (isWriteOnlyField(fdef)) {
    throw bootRuleError(FORM_FIELD_RULES.writeOnlyField, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (${context}) field "${fieldName}" declares writeOnly — ` +
        `writeOnly only applies to entity fields (nothing to hide on a form that stores no value). ` +
        `Use format: "password" for a masked input.`,
    });
  }
}

// Static options XOR optionsQuery on inline-form select fields, and `{ field }`
// payload refs must name another field of the same form (the payload also feeds
// optionsAvailabilityQuery). The QN existence check
// lives in query-refs.ts with the other query refs.
const CONDITIONAL_OPTIONS_ENTITY_ONLY =
  "conditionalOptions is only supported on entity select fields (enforced by the entity write path)";

export function validateFormSelectOptions(
  featureName: string,
  screenId: string,
  context: string,
  fieldName: string,
  fdef: FieldDefinition,
  siblingFieldNames: ReadonlySet<string>,
): void {
  if (fdef.type === "select") {
    const where = `[Feature ${featureName}] Screen "${screenId}" (${context}) select field "${fieldName}"`;
    if (fdef.conditionalOptions !== undefined) {
      throw bootRuleError(FORM_FIELD_RULES.selectConditionalOptions, {
        message: `${where} declares conditionalOptions — ${CONDITIONAL_OPTIONS_ENTITY_ONLY}. Remove conditionalOptions from this field.`,
      });
    }
    if (fdef.optionsQuery !== undefined) {
      if (fdef.optionsQuery.length === 0) {
        throw bootRuleError(FORM_FIELD_RULES.selectOptionsQueryEmpty, {
          message: `${where} has an empty optionsQuery. Set it to a query name or remove it.`,
        });
      }
      if (fdef.options.length > 0) {
        throw bootRuleError(FORM_FIELD_RULES.selectOptionsAndQuery, {
          message: `${where} declares both options and optionsQuery — pick one`,
        });
      }
      if (fdef.optionsAvailabilityQuery !== undefined) {
        throw bootRuleError(FORM_FIELD_RULES.selectQueryAndAvailability, {
          message: `${where} declares both optionsQuery and optionsAvailabilityQuery — availability only applies to static options`,
        });
      }
      validateOptionsQueryFieldRefs(where, fieldName, fdef.optionsQueryPayload, siblingFieldNames);
    } else if (fdef.optionsAvailabilityQuery !== undefined) {
      if (fdef.optionsAvailabilityQuery.length === 0) {
        throw bootRuleError(FORM_FIELD_RULES.optionsAvailabilityQueryEmpty, {
          message: `${where} has an empty optionsAvailabilityQuery. Set it to a query name or remove it.`,
        });
      }
      validateOptionsQueryFieldRefs(where, fieldName, fdef.optionsQueryPayload, siblingFieldNames);
    } else if (fdef.optionsQueryPayload !== undefined) {
      throw bootRuleError(FORM_FIELD_RULES.optionsQueryPayloadWithoutQuery, {
        message: `${where} has optionsQueryPayload without optionsQuery. Set optionsQuery or remove optionsQueryPayload.`,
      });
    }
  } else if (fdef.type === "multiSelect" && fdef.optionsAvailabilityQuery !== undefined) {
    if (fdef.optionsAvailabilityQuery.length === 0) {
      throw bootRuleError(FORM_FIELD_RULES.optionsAvailabilityQueryEmpty, {
        message: `[Feature ${featureName}] Screen "${screenId}" (${context}) multiSelect field "${fieldName}" has an empty optionsAvailabilityQuery. Set it to a query name or remove it.`,
      });
    }
  }
}

// Fail-closed currency-source gate, the runtime half of the
// narrowed `FormFieldDefinition` — an untyped JS consumer has no compiler to
// stop it. An inline form screen has no entity, so a money field there can't
// borrow `entity.defaultCurrency`: without a declared source the renderer
// seeds a bare `0` and the handler's zod schema rejects the submit. Entity
// money fields are exempt — create-app already refuses an entity that holds
// money without a `defaultCurrency`.
function validateFormMoneyCurrency(
  featureName: string,
  screenId: string,
  context: string,
  fieldName: string,
  fdef: unknown,
): void {
  const where = `[Feature ${featureName}] Screen "${screenId}" (${context}) money field "${fieldName}"`;
  const validForms =
    `Declare \`currency: { kind: "literal", code: "EUR" }\` for a fixed currency, or ` +
    `\`currency: { kind: "tenant" }\` to take the tenant-settings bundle's per-tenant currency.`;
  // @cast-boundary schema-walk — feature-config inspection (Author may circumvent type-check)
  const currency = (fdef as { currency?: { kind?: unknown; code?: unknown } | null }).currency;
  if (currency === undefined) {
    throw bootRuleError(FORM_FIELD_RULES.moneyCurrencyMissing, {
      message:
        `${where} must declare where its currency comes from — this screen has no entity whose ` +
        `\`defaultCurrency\` it could inherit, so the form would seed a bare \`0\` that the ` +
        `handler's schema rejects. ${validForms}`,
    });
  }
  if (typeof currency !== "object" || currency === null) {
    throw bootRuleError(FORM_FIELD_RULES.moneyCurrencyNotObject, {
      message: `${where} has a non-object \`currency\`. ${validForms}`,
    });
  }
  const kind = currency.kind;
  if (kind === "literal") {
    const code = currency.code;
    if (typeof code !== "string" || code.trim() === "") {
      throw bootRuleError(FORM_FIELD_RULES.moneyCurrencyLiteralCode, {
        message:
          `${where} declares \`currency: { kind: "literal" }\` with an empty or non-string \`code\`. ` +
          `Pass the ISO code, e.g. { kind: "literal", code: "EUR" }.`,
      });
    }
  } else if (kind !== "tenant") {
    throw bootRuleError(FORM_FIELD_RULES.moneyCurrencyUnknownKind, {
      message: `${where} declares an unknown currency kind ${JSON.stringify(kind)}. ${validForms}`,
    });
  }
}

// `allowEmptySections` mirrors `validateFormFieldsMap`'s `allowEmpty` — the
// caller only ever passes true together with an actually-empty fields map
// (an input-less secretMint declares BOTH `fields: {}` and
// `layout.sections: []`; fields declared with no layout to show them stays
// an error).
// `fields`/`groups` are mutually exclusive on a fields-kind section; shared by
// every EditLayout-walking screen type instead of four hand-rolled copies.
export function validateFieldsXorGroups(
  errorPrefix: string,
  section: FieldsOrGroupsSection & { readonly title?: string },
): void {
  if (section.fields !== undefined && section.groups !== undefined) {
    throw bootRuleError(FORM_LAYOUT_RULES.sectionFieldsAndGroups, {
      message:
        `${errorPrefix} section "${section.title}" declares both fields and groups — remove ` +
        `\`fields: []\` when using groups.`,
    });
  }
  if ((section.fields?.length ?? 0) === 0 && (section.groups?.length ?? 0) === 0) {
    throw bootRuleError(FORM_LAYOUT_RULES.sectionEmpty, {
      message:
        `${errorPrefix} has a section "${section.title}" with zero fields — drop the section or add ` +
        `fields (or groups) to it.`,
    });
  }
}

function validateFormLayoutSections(
  featureName: string,
  screenId: string,
  context: string,
  layout: EditLayout,
  fieldNames: ReadonlySet<string>,
  fieldDefs: Readonly<Record<string, { readonly type: string }>>,
  allowEmptySections: boolean,
): void {
  if (layout.sections.length === 0) {
    // skip: an input-less secretMint declares fields: {} and sections: [] together — no sections to validate.
    if (allowEmptySections) return;
    throw bootRuleError(FORM_LAYOUT_RULES.sectionsEmpty, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (${context}) has an empty sections list — ` +
        `declare at least one section.`,
    });
  }
  for (const section of layout.sections) {
    if (isExtensionEditSection(section)) {
      if (section.component?.react === undefined && section.component?.native === undefined) {
        throw bootRuleError(FORM_LAYOUT_RULES.extensionSectionNoComponent, {
          message:
            `[Feature ${featureName}] Screen "${screenId}" (${context}) extension section ` +
            `"${section.title}" has no component — declare a react/native component marker.`,
        });
      }
      continue;
    }
    if (section.kind === "relatedList") {
      throw bootRuleError(FORM_LAYOUT_RULES.relatedListSectionUnsupported, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${context}) relatedList section ` +
          `"${section.title}" is not supported — relatedList is a projectionDetail-only ` +
          `primitive (fw#2166). Move the section to a projectionDetail screen or remove it.`,
      });
    }
    if (isWriteFormEditSection(section)) {
      throw bootRuleError(FORM_LAYOUT_RULES.writeFormSectionUnsupported, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (${context}) writeForm section ` +
          `"${section.title}" is not supported — writeForm is a projectionDetail-only primitive. Move the section to a projectionDetail screen or remove it.`,
      });
    }
    validateFieldsXorGroups(`[Feature ${featureName}] Screen "${screenId}" (${context})`, section);
    for (const fieldSpec of sectionFieldSpecs(section)) {
      const normalized = normalizeEditField(fieldSpec);
      if (!fieldNames.has(normalized.field)) {
        throw bootRuleError(FORM_LAYOUT_RULES.layoutUnknownField, {
          message:
            `[Feature ${featureName}] Screen "${screenId}" (${context}) layout references unknown field ` +
            `"${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
        });
      }
      const fieldWhere = `[Feature ${featureName}] Screen "${screenId}" (${context}) field "${normalized.field}"`;
      validateFieldFormRefs(fieldWhere, normalized, fieldNames);
      validateFillActionTarget(fieldWhere, normalized, fieldDefs[normalized.field]);
    }
  }
}

function validateSuccessLink(
  feature: FeatureDefinition,
  screenId: string,
  kind: "actionForm" | "secretMint",
  link: ActionFormSuccessLink,
  lookups: NavigateTargetLookups,
  propertyPath: string,
): void {
  if (link.idFrom === undefined) {
    validateIdlessSuccessLink(feature, screenId, "actionForm", link, lookups, propertyPath);
  } else {
    validateRedirectTarget(
      feature,
      screenId,
      kind,
      { ...link, idFrom: link.idFrom },
      lookups,
      propertyPath,
    );
  }
}

function validateInlineFormNavTargets(
  feature: FeatureDefinition,
  screenId: string,
  screen: ActionFormScreenDefinition | SecretMintScreenDefinition,
  kind: "actionForm" | "secretMint",
  lookups: NavigateTargetLookups,
): void {
  const { allScreenQns } = lookups;
  if (screen.redirect !== undefined) {
    validateRedirectTarget(feature, screenId, kind, screen.redirect, lookups);
  }
  if (
    screen.type === "actionForm" &&
    screen.successFacts !== undefined &&
    screen.redirect !== undefined
  ) {
    throw bootRuleError(FORM_LAYOUT_RULES.successFactsWithRedirect, {
      message:
        `[Feature ${feature.name}] Screen "${screenId}" (actionForm) sets both redirect and successFacts — ` +
        `redirect leaves the screen, successFacts are shown on it. Use one of them.`,
    });
  }
  if (screen.type === "actionForm" && screen.successLinks !== undefined) {
    if (screen.redirect !== undefined) {
      throw bootRuleError(FORM_LAYOUT_RULES.successLinksWithRedirect, {
        message:
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) sets both redirect and successLinks — ` +
          `redirect leaves the screen, successLinks keep it open. Use one of them.`,
      });
    }
    screen.successLinks.forEach((link, index) => {
      validateSuccessLink(feature, screenId, kind, link, lookups, `successLinks[${index}]`);
    });
  }
  if (screen.type === "actionForm" && screen.successItems !== undefined) {
    if (screen.redirect !== undefined) {
      throw bootRuleError(SCREEN_ACTION_RULES.actionFormSuccessItemsRedirect, {
        message:
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) sets both redirect and successItems — ` +
          `redirect leaves the screen, successItems are shown on it. Use one of them.`,
      });
    }
    if (screen.successItems.link !== undefined) {
      validateSuccessLink(
        feature,
        screenId,
        kind,
        screen.successItems.link,
        lookups,
        "successItems.link",
      );
    }
  }
  if (typeof screen.cancelTarget === "string") {
    // Same rule as redirect — `false` (no Cancel button) needs no validation.
    validateScreenNavTarget(
      feature.name,
      screenId,
      kind,
      "cancelTarget",
      screen.cancelTarget,
      allScreenQns,
      feature.screens,
    );
  }
}

// actionForm/secretMint have no entity link, only a write-handler QN +
// inline fields: checks handler registration, field types, layout refs, and nav targets.
export function validateInlineFormScreen(
  feature: FeatureDefinition,
  screenId: string,
  screen: ActionFormScreenDefinition | SecretMintScreenDefinition,
  kind: "actionForm" | "secretMint",
  allWriteHandlerQns: ReadonlySet<string>,
  lookups: NavigateTargetLookups,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  validateWriteHandlerRegistered(feature.name, screenId, kind, screen.handler, allWriteHandlerQns);
  // Only a secretMint's own mint step may skip fields/sections entirely
  // (input-less mint) — actionForm always needs at least one field.
  const allowEmptyMintForm = kind === "secretMint";
  const fieldNames = validateFormFieldsMap(
    feature.name,
    screenId,
    kind,
    screen.fields,
    allowEmptyMintForm,
  );
  validateFormLayoutSections(
    feature.name,
    screenId,
    kind,
    screen.layout,
    fieldNames,
    screen.fields,
    allowEmptyMintForm && fieldNames.size === 0,
  );
  validateWizardLayout(feature.name, screenId, kind, screen.layout, featureMap);
  if (screen.type === "actionForm") {
    validateFormDerivations(feature.name, screenId, screen);
    validateFormDerivationsEnforced(feature.name, screenId, screen, featureMap);
  }
  if (
    screen.type === "actionForm" &&
    screen.load?.singleton === true &&
    screen.load.idParam !== undefined
  ) {
    throw bootRuleError(FORM_LAYOUT_RULES.loadSingletonWithIdParam, {
      message:
        `[Feature ${feature.name}] Screen "${screenId}" (actionForm) sets both load.singleton: true ` +
        `and load.idParam — singleton means the query picks the row from the caller's context, so ` +
        `there is no record id to send under idParam. Remove idParam.`,
    });
  }
  validateInlineFormNavTargets(feature, screenId, screen, kind, lookups);
}

// SecretMintConfirmStep: an optional proof-of-receipt form rendered
// on the reveal card in place of the bare acknowledge button (TOTP enrollment:
// scan the code, then enter one). Unlike the mint step, confirm always needs
// at least one field — a step whose only job is proving receipt with no input
// would be meaningless — and its layout is a single plain form, never a
// wizard/tabs flow and never a persisted draft: a one-time reveal-confirm is
// not a multi-step flow, and persisting a draft of it would re-open the leak
// (a lingering copy of the just-revealed secret in storage).
export function validateSecretMintConfirm(
  feature: FeatureDefinition,
  screenId: string,
  screen: SecretMintScreenDefinition,
  allWriteHandlerQns: ReadonlySet<string>,
): void {
  const confirm = screen.confirm;
  // skip: the screen declares no confirm step — nothing to validate.
  if (confirm === undefined) return;
  const context = "secretMint confirm";
  validateWriteHandlerRegistered(
    feature.name,
    screenId,
    context,
    confirm.handler,
    allWriteHandlerQns,
  );
  const fieldNames = validateFormFieldsMap(feature.name, screenId, context, confirm.fields, false);
  validateFormLayoutSections(
    feature.name,
    screenId,
    context,
    confirm.layout,
    fieldNames,
    confirm.fields,
    false,
  );
  if (confirm.layout.mode !== undefined && confirm.layout.mode !== "single") {
    throw bootRuleError(FORM_LAYOUT_RULES.confirmLayoutMode, {
      message:
        `[Feature ${feature.name}] Screen "${screenId}" (${context}) sets layout.mode: ` +
        `"${confirm.layout.mode}" — a one-time reveal confirm step must stay a single-step form. ` +
        `Remove mode or set it to "single".`,
    });
  }
  if (confirm.layout.draft === true) {
    throw bootRuleError(FORM_LAYOUT_RULES.confirmLayoutDraft, {
      message:
        `[Feature ${feature.name}] Screen "${screenId}" (${context}) sets layout.draft: true — ` +
        `persisting a draft of the reveal-confirm step would leak the one-time secret into storage, ` +
        `the exact leak fw#2548 closed. Remove draft: true.`,
    });
  }
  // skip: no carry list declared — no carried fields to cross-check against confirm.fields.
  if (confirm.carry === undefined) return;
  for (const carryField of confirm.carry) {
    if (typeof carryField !== "string" || carryField.trim() === "") {
      throw bootRuleError(FORM_LAYOUT_RULES.confirmCarryEntryEmpty, {
        message:
          `[Feature ${feature.name}] Screen "${screenId}" (${context}) has an empty or non-string ` +
          `entry in "carry". Use non-empty strings in carry.`,
      });
    }
    if (fieldNames.has(carryField)) {
      throw bootRuleError(FORM_LAYOUT_RULES.confirmCarryCollidesField, {
        message:
          `[Feature ${feature.name}] Screen "${screenId}" (${context}) carry field "${carryField}" ` +
          `also names a confirm.fields entry — a carried mint-payload value would silently ` +
          `overwrite the user-entered field of the same name. Rename one of them.`,
      });
    }
  }
}
