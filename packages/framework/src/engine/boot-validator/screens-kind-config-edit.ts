import { isEncryptedAtRest } from "../config-helpers.ts";
import {
  isExtensionEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "../screen-helpers.ts";
import type {
  ConfigEditScreenDefinition,
  EditExtensionSection,
  EditSectionSpec,
} from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import {
  isWriteOnlyField,
  validateConfigEditSecretField,
  validateFieldsXorGroups,
  validateFormSelectOptions,
  validateWizardLayout,
} from "./screens-forms.ts";
import { SCREEN_KIND_RULES } from "./screens-kind-rules.ts";
import {
  assertExtensionSectionHasComponent,
  rejectEmptySections,
  rejectProjectionDetailOnlySection,
  type ScreenValidationContext,
} from "./screens-kind-shared.ts";

function validateConfigEditFields(
  featureName: string,
  screenId: string,
  screen: ConfigEditScreenDefinition,
  fieldNames: ReadonlySet<string>,
): void {
  if (fieldNames.size === 0) {
    throw bootRuleError(SCREEN_KIND_RULES.configEditFieldsEmpty, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (configEdit) has empty fields map — ` +
        `declare at least one field.`,
    });
  }
  for (const [fname, fdef] of Object.entries(screen.fields)) {
    const fieldType: unknown = fdef.type;
    if (typeof fieldType !== "string" || fieldType.length === 0) {
      throw bootRuleError(SCREEN_KIND_RULES.configEditFieldTypeMissing, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (configEdit) field "${fname}" has no ` +
          `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
      });
    }
    validateFormSelectOptions(featureName, screenId, "configEdit", fname, fdef, fieldNames);
  }
}

function validateConfigEditFieldsSection(
  featureName: string,
  screenId: string,
  fieldNames: ReadonlySet<string>,
  section: Exclude<EditSectionSpec, EditExtensionSection>,
): void {
  rejectProjectionDetailOnlySection(featureName, screenId, "configEdit", section);
  validateFieldsXorGroups(`[Feature ${featureName}] Screen "${screenId}" (configEdit)`, section);
  for (const fieldSpec of sectionFieldSpecs(section)) {
    const normalized = normalizeEditField(fieldSpec);
    if (!fieldNames.has(normalized.field)) {
      throw bootRuleError(SCREEN_KIND_RULES.configEditLayoutUnknownField, {
        message:
          `[Feature ${featureName}] Screen "${screenId}" (configEdit) layout references unknown ` +
          `field "${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
      });
    }
  }
}

function validateConfigEditSection(
  featureName: string,
  screenId: string,
  fieldNames: ReadonlySet<string>,
  section: EditSectionSpec,
): void {
  if (isExtensionEditSection(section)) {
    assertExtensionSectionHasComponent(featureName, screenId, "configEdit", section);
  } else {
    validateConfigEditFieldsSection(featureName, screenId, fieldNames, section);
  }
}

// configKeys: every fieldName must have a mapping entry, and every qualified
// key must exist in the registry.
function validateConfigEditFieldKey(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ConfigEditScreenDefinition,
  fname: string,
): void {
  const secretQn = screen.secretKeys?.[fname];
  if (secretQn !== undefined) {
    validateConfigEditSecretField(ctx.feature.name, screen, fname, secretQn, ctx.featureMap);
  } else {
    validateConfigKeyMapping(ctx, screenId, screen, fname);
  }
}

function validateConfigKeyMapping(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ConfigEditScreenDefinition,
  fname: string,
): void {
  const featureName = ctx.feature.name;
  const qualified = screen.configKeys[fname];
  if (qualified === undefined) {
    throw bootRuleError(SCREEN_KIND_RULES.configEditFieldWithoutConfigKey, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (configEdit) field "${fname}" has ` +
        `no entry in the configKeys map. Every declared field needs a mapping to a ` +
        `qualified config key (\`<feature>:config:<short>\`). Add one to configKeys.`,
    });
  }
  const configKeyDef = ctx.configKeyDefsByQn.get(qualified);
  if (configKeyDef === undefined) {
    throw bootRuleError(SCREEN_KIND_RULES.configEditConfigKeyUnknown, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (configEdit) field "${fname}" → ` +
        `Config key "${qualified}" is not declared in any feature registry. Typo? ` +
        `Expected format: "<feature>:config:<short>". Known keys: ${
          [...ctx.configKeyDefsByQn.keys()].sort().join(", ") || "(none)"
        }`,
    });
  }
  if (isWriteOnlyField(screen.fields[fname]) && !isEncryptedAtRest(configKeyDef)) {
    throw bootRuleError(SCREEN_KIND_RULES.configEditWriteOnlyNotEncrypted, {
      message:
        `[Feature ${featureName}] Screen "${screenId}" (configEdit) field "${fname}" declares writeOnly ` +
        `but config key "${qualified}" is not encrypted at rest — writeOnly on a configEdit field ` +
        `only hides a stored secret (declare the key with encrypted: true or backing: "secrets").`,
    });
  }
}

// Validate configEdit layout and fields like actionForm, then verify that
// every qualified config key is registered and its scope matches the key.
export function validateConfigEditScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ConfigEditScreenDefinition,
): void {
  const featureName = ctx.feature.name;
  const fieldNames = new Set(Object.keys(screen.fields));
  validateConfigEditFields(featureName, screenId, screen, fieldNames);
  rejectEmptySections(featureName, screenId, "configEdit", screen.layout.sections.length);
  for (const section of screen.layout.sections) {
    validateConfigEditSection(featureName, screenId, fieldNames, section);
  }
  validateWizardLayout(featureName, screenId, "configEdit", screen.layout, ctx.featureMap);
  for (const fname of Object.keys(screen.secretKeys ?? {})) {
    if (!fieldNames.has(fname)) {
      throw bootRuleError(SCREEN_KIND_RULES.configEditSecretKeyUnknownField, {
        message: `[Feature ${featureName}] Screen "${screenId}" (configEdit) secretKeys names unknown field "${fname}".`,
      });
    }
  }
  for (const fname of fieldNames) {
    validateConfigEditFieldKey(ctx, screenId, screen, fname);
  }
}
