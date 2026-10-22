import {
  isExtensionEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "../screen-helpers.ts";
import type { EntityDefinition } from "../types/index.ts";
import type { EditSectionSpec, EntityEditScreenDefinition } from "../types/screen.ts";
import { validateRedirectTarget } from "./screens-actions.ts";
import {
  validateEditFieldExtras,
  validateFieldFormRefs,
  validateFieldsXorGroups,
  validateFillActionTarget,
  validateNoWidgetRequiredField,
  validateWizardLayout,
} from "./screens-forms.ts";
import {
  assertExtensionSectionHasComponent,
  buildUnknownFieldMessage,
  rejectEmptySections,
  rejectProjectionDetailOnlySection,
  resolveScreenEntity,
  type ScreenValidationContext,
  validateRecordHeaderAction,
  validateRecordSectionActions,
} from "./screens-kind-shared.ts";

function validateEntityEditField(
  featureName: string,
  screenId: string,
  entityName: string,
  entityDef: EntityDefinition,
  fieldNames: ReadonlySet<string>,
  fieldSpec: Parameters<typeof normalizeEditField>[0],
): void {
  const normalized = normalizeEditField(fieldSpec);
  if (!fieldNames.has(normalized.field)) {
    throw new Error(
      buildUnknownFieldMessage(featureName, screenId, normalized.field, entityName, fieldNames),
    );
  }
  validateNoWidgetRequiredField(featureName, screenId, entityDef, normalized);
  validateEditFieldExtras(featureName, screenId, entityDef, normalized);
  const fieldWhere = `[Feature ${featureName}] Screen "${screenId}" (entityEdit) field "${normalized.field}"`;
  validateFieldFormRefs(fieldWhere, normalized, fieldNames);
  validateFillActionTarget(fieldWhere, normalized, entityDef.fields[normalized.field]);
}

function validateEntityEditSection(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: EntityEditScreenDefinition,
  entityDef: EntityDefinition,
  fieldNames: ReadonlySet<string>,
  section: EditSectionSpec,
): void {
  const featureName = ctx.feature.name;
  validateRecordSectionActions(ctx, screenId, "entityEdit", section);
  if (isExtensionEditSection(section)) {
    assertExtensionSectionHasComponent(featureName, screenId, "entityEdit", section);
  } else {
    rejectProjectionDetailOnlySection(featureName, screenId, "entityEdit", section);
    validateFieldsXorGroups(`[Feature ${featureName}] Screen "${screenId}" (entityEdit)`, section);
    for (const fieldSpec of sectionFieldSpecs(section)) {
      validateEntityEditField(
        featureName,
        screenId,
        screen.entity,
        entityDef,
        fieldNames,
        fieldSpec,
      );
    }
  }
}

export function validateEntityEditScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: EntityEditScreenDefinition,
): void {
  const featureName = ctx.feature.name;
  const entityDef = resolveScreenEntity(ctx, screenId, screen.entity);
  const fieldNames = new Set(Object.keys(entityDef.fields));
  rejectEmptySections(featureName, screenId, "entityEdit", screen.layout.sections.length);
  for (const section of screen.layout.sections) {
    validateEntityEditSection(ctx, screenId, screen, entityDef, fieldNames, section);
  }
  validateWizardLayout(featureName, screenId, "entityEdit", screen.layout, ctx.featureMap);
  for (const action of screen.actions ?? []) {
    validateRecordHeaderAction(ctx, screenId, "entityEdit", screen.entity, action);
  }
  if (screen.recordTitleField !== undefined && !fieldNames.has(screen.recordTitleField)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityEdit) recordTitleField ` +
        `"${screen.recordTitleField}" is not a field of entity "${screen.entity}" ` +
        `(known: ${[...fieldNames].sort().join(", ")}).`,
    );
  }
  if (typeof screen.readOnly === "object" && !fieldNames.has(screen.readOnly.field)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityEdit) readOnly condition field ` +
        `"${screen.readOnly.field}" is not a field of entity "${screen.entity}" ` +
        `(known: ${[...fieldNames].sort().join(", ")}).`,
    );
  }
  if (screen.redirect !== undefined) {
    validateRedirectTarget(ctx.feature, screenId, "entityEdit", screen.redirect, ctx);
  }
}
