import { SELECT_OPTION_TONES } from "@cosmicdrift/kumiko-types/fields";
import {
  isExtensionEditSection,
  isFieldsEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  sectionFieldSpecs,
} from "../screen-helpers.ts";
import type {
  EditExtensionSection,
  EditFieldsSection,
  EditRelatedListSection,
  EditSectionSpec,
  EditWriteFormSection,
  MetricSpec,
  ProjectionDetailScreenDefinition,
  RecordHeaderSubtitlePart,
} from "../types/screen.ts";
import {
  assertWriteHandlerRegistered,
  resolveRowActionNavigateTarget,
  validateActionHasIcon,
  validatePrimaryActionTarget,
} from "./screens-actions.ts";
import {
  rejectWriteOnlyFormField,
  validateFieldsXorGroups,
  validateFormSelectOptions,
  validateTabSections,
} from "./screens-forms.ts";
import {
  assertExtensionSectionHasComponent,
  editSectionLabel,
  listActionContext,
  navigateActionFromLink,
  rejectEmptySections,
  rejectMissingQuery,
  type ScreenValidationContext,
  validateRecordHeaderAction,
  validateRecordSectionActions,
} from "./screens-kind-shared.ts";
import {
  assertRefTargetRegistered,
  validateListActionTargets,
  validateRelatedListSection,
} from "./screens-lists.ts";
import { isSelectOptionTone } from "./select-option-tone.ts";

function validateProjectionDetailFlags(
  featureName: string,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  if (screen.singleton === true && screen.idParam !== undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) sets both singleton: true ` +
        `and idParam — singleton means the server picks the row from the caller's context, so there ` +
        `is no row id to send under idParam. Remove idParam.`,
    );
  }
  // singleton has no row id in the path, but the auto-generated "Edit"
  // action (defaultEditAction in kumiko-screen.tsx) navigates
  // to the detailFor entity's entityEdit screen using that path id —
  // under singleton it would silently open that screen in CREATE mode
  // instead of editing the singleton row. Reject rather than let that
  // win silently, same as the idParam check above.
  if (screen.singleton === true && screen.detailFor !== undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) sets both singleton: true ` +
        `and detailFor — the auto-generated "Edit" action navigates using the path's row id, which a ` +
        `singleton screen never has. Remove detailFor, or declare an explicit "edit" action instead.`,
    );
  }
  if (screen.recordTitleField !== undefined && screen.header !== undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) sets both header and ` +
        `recordTitleField — header.title already names the record, so drop recordTitleField.`,
    );
  }
}

function validateProjectionDetailTabs(
  featureName: string,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  if (screen.layout.mode === "tabs") {
    validateTabSections(featureName, screenId, "projectionDetail", screen.layout.sections);
    for (const section of screen.layout.sections) {
      if (isFieldsEditSection(section) && "groups" in section && section.actions !== undefined) {
        throw new Error(
          `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) section "${section.id}" ` +
            `declares both groups and actions in tabs mode — actions has no single group's Card to sit ` +
            `in, and an extra title-less Card around the group cards would nest a Card inside a Card. ` +
            `Move the actions onto one group's title, or drop groups for a flat fields grid.`,
        );
      }
    }
  }
}

function validateProjectionDetailMetricNavigate(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
  field: string,
  navigate: NonNullable<MetricSpec["navigate"]>,
): void {
  const featureName = ctx.feature.name;
  if (navigate.screen === undefined && navigate.entity === undefined) {
    if (
      navigate.tab !== undefined &&
      !screen.layout.sections.some((section) => section.id === navigate.tab)
    ) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) metric "${field}" ` +
          `navigates to tab "${navigate.tab}", which is not a section id on this screen. Navigate to an existing section id or remove navigate.tab.`,
      );
    }
  } else {
    // Also runs without `tab`: a typo'd screen/entity or an entity
    // target without entityId would otherwise render a clickable
    // metric that silently does nothing.
    resolveRowActionNavigateTarget(
      featureName,
      screenId,
      "projectionDetail",
      "metric",
      navigateActionFromLink(field, navigate),
      ctx.allScreenQns,
      ctx.navTargetShortIds,
      ctx.screensByShortId,
      ctx.detailForScreens,
    );
  }
}

function validateProjectionDetailMetric(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
  metric: MetricSpec,
): void {
  if (typeof metric.label !== "string" || metric.label.length === 0) {
    throw new Error(
      `[Feature ${ctx.feature.name}] Screen "${screenId}" (projectionDetail) metric "${metric.field}" has ` +
        `no "label" — every metric needs an i18n label key, ` +
        `there is no fallback to the raw column name.`,
    );
  }
  if (metric.navigate !== undefined) {
    validateProjectionDetailMetricNavigate(ctx, screenId, screen, metric.field, metric.navigate);
  }
}

function validateProjectionDetailStatusTones(
  featureName: string,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  for (const [statusValue, tone] of Object.entries(screen.header?.statusTones ?? {})) {
    if (!isSelectOptionTone(tone)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) header.statusTones["${statusValue}"] ` +
          `is "${String(tone)}" — expected one of ${SELECT_OPTION_TONES.join(", ")}.`,
      );
    }
  }
}

function validateProjectionDetailSubtitleParts(
  ctx: ScreenValidationContext,
  screenId: string,
  subtitleHref: string | undefined,
  parts: readonly RecordHeaderSubtitlePart[],
): void {
  const featureName = ctx.feature.name;
  if (subtitleHref !== undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) sets header.subtitleHref ` +
        `together with a multi-part header.subtitle — subtitleHref only works with the string form. Use a single-field subtitle or remove subtitleHref.`,
    );
  }
  const seenPartFields = new Set<string>();
  for (const part of parts) {
    const partField = typeof part === "string" ? part : part.field;
    if (seenPartFields.has(partField)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) header.subtitle ` +
          `lists field "${partField}" twice. List each field once.`,
      );
    }
    seenPartFields.add(partField);
    const navigate = typeof part === "string" ? undefined : part.navigate;
    if (navigate === undefined) continue;
    if (navigate.screen === undefined && navigate.entity === undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) header.subtitle part ` +
          `"${partField}" navigates with neither "screen" nor "entity" — a tab-only navigate has no link target.`,
      );
    }
    resolveRowActionNavigateTarget(
      featureName,
      screenId,
      "projectionDetail",
      "subtitle part",
      navigateActionFromLink(partField, navigate),
      ctx.allScreenQns,
      ctx.navTargetShortIds,
      ctx.screensByShortId,
      ctx.detailForScreens,
    );
  }
}

function validateProjectionDetailSubtitle(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  const header = screen.header;
  if (header !== undefined && Array.isArray(header.subtitle)) {
    validateProjectionDetailSubtitleParts(ctx, screenId, header.subtitleHref, header.subtitle);
  }
}

function validateProjectionDetailExtensionSection(
  featureName: string,
  screenId: string,
  section: EditExtensionSection,
): void {
  // projectionDetail is read-only (no composed form submit) — an
  // extension that persists through the host's Save button has
  // nothing to save against. Extensions that persist themselves
  // (e.g. notes-history NotesSection, via their own dispatcher
  // writes) are fine.
  if (section.contributesToFormSubmit === true) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) extension section ` +
        `"${section.title}" sets contributesToFormSubmit: true, but projectionDetail has no ` +
        `form submit to contribute to (read-only screen). Omit contributesToFormSubmit and ` +
        `persist through the extension's own dispatcher writes instead.`,
    );
  }
  assertExtensionSectionHasComponent(featureName, screenId, "projectionDetail", section);
  // The host-derived entity name on projectionDetail is an internal
  // placeholder (no real entity backs this screen) — a self-
  // persisting extension needs the real domain entity name declared
  // explicitly, or it silently reads/writes against the wrong type.
  if (section.entityName === undefined || section.entityName.trim().length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) extension section ` +
        `"${section.title}" has no entityName — projectionDetail has no real entity, so the ` +
        `extension must declare entityName explicitly (the domain entity it persists against).`,
    );
  }
}

function validateProjectionDetailRelatedList(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
  section: EditRelatedListSection,
): void {
  if (screen.layout.mode === "wizard") {
    throw new Error(
      `[Feature ${ctx.feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
        `is kind "relatedList" in a wizard layout — a read-only list is not supported in a ` +
        `stepped form. Remove mode: "wizard" or drop the relatedList section.`,
    );
  }
  validateRelatedListSection({
    featureName: ctx.feature.name,
    featureMap: ctx.featureMap,
    screenId,
    screenType: "projectionDetail",
    where: `Screen "${screenId}" (projectionDetail) section "${section.title}" (relatedList)`,
    section,
    screens: ctx.feature.screens,
    allWriteHandlerQns: ctx.allWriteHandlerQns,
    allScreenQns: ctx.allScreenQns,
    navTargetShortIds: ctx.navTargetShortIds,
    screensByShortId: ctx.screensByShortId,
    detailForScreens: ctx.detailForScreens,
  });
}

function validateProjectionDetailWriteForm(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
  section: EditWriteFormSection,
): void {
  const featureName = ctx.feature.name;
  if (Object.keys(section.fieldDefs).length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
        `(writeForm) has an empty fieldDefs map — declare at least one field type.`,
    );
  }
  if (section.fields.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
        `(writeForm) has zero fields — drop the section or add fields to it.`,
    );
  }
  // A ref to a fieldDef the form never renders would never resolve.
  const writeFormFieldNames = new Set(section.fields.map((f) => normalizeEditField(f).field));
  for (const [defName, fdef] of Object.entries(section.fieldDefs)) {
    validateFormSelectOptions(
      featureName,
      screenId,
      `projectionDetail section "${section.title}" writeForm`,
      defName,
      fdef,
      writeFormFieldNames,
    );
    rejectWriteOnlyFormField(
      featureName,
      screenId,
      `projectionDetail section "${section.title}" writeForm`,
      defName,
      fdef,
    );
  }
  for (const f of section.fields) {
    const fieldName = normalizeEditField(f).field;
    if (section.fieldDefs[fieldName] === undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
          `(writeForm) field "${fieldName}" has no entry in fieldDefs — every rendered field needs ` +
          `a type declared there. Add the field to fieldDefs.`,
      );
    }
  }
  if (screen.layout.mode === "wizard") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
        `is kind "writeForm" in a wizard layout — a self-persisting form is not supported in a ` +
        `stepped form. Remove mode: "wizard" or drop the writeForm section.`,
    );
  }
  assertWriteHandlerRegistered(
    featureName,
    `Screen "${screenId}" (projectionDetail) section "${section.title}" (writeForm)`,
    section.handler,
    ctx.allWriteHandlerQns,
  );
}

function validateProjectionDetailFieldsSection(
  ctx: ScreenValidationContext,
  screenId: string,
  section: EditFieldsSection,
): void {
  const featureName = ctx.feature.name;
  validateFieldsXorGroups(
    `[Feature ${featureName}] Screen "${screenId}" (projectionDetail)`,
    section,
  );
  for (const fieldSpec of sectionFieldSpecs(section)) {
    const normalizedField = normalizeEditField(fieldSpec);
    if (normalizedField.refEntity !== undefined) {
      assertRefTargetRegistered(
        `[Feature ${featureName}] Screen "${screenId}" (projectionDetail)`,
        `field "${normalizedField.field}" (refEntity)`,
        normalizedField.refEntity,
        featureName,
        ctx.featureMap,
      );
    }
  }
}

function validateProjectionDetailSection(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
  section: EditSectionSpec,
): void {
  const featureName = ctx.feature.name;
  validateRecordSectionActions(ctx, screenId, "projectionDetail", section);
  if (section.kind === "relatedList" && section.emptyState?.action !== undefined) {
    const sectionLabel = editSectionLabel(section);
    validateActionHasIcon(
      featureName,
      screenId,
      "projectionDetail",
      `section "${sectionLabel}" emptyState action`,
      section.emptyState.action,
    );
    validateListActionTargets(
      listActionContext(
        ctx,
        screenId,
        "projectionDetail",
        undefined,
        `Screen "${screenId}" (projectionDetail) section "${sectionLabel}"`,
      ),
      "emptyState action",
      section.emptyState.action,
    );
  }
  if (isExtensionEditSection(section)) {
    validateProjectionDetailExtensionSection(featureName, screenId, section);
  } else if (section.kind === "relatedList") {
    validateProjectionDetailRelatedList(ctx, screenId, screen, section);
  } else if (isWriteFormEditSection(section)) {
    validateProjectionDetailWriteForm(ctx, screenId, screen, section);
  } else {
    validateProjectionDetailFieldsSection(ctx, screenId, section);
  }
}

// Query-driven like projectionList, but a single row plus layout instead of
// columns. No entity check is possible: fields resolve against the query
// response at render time, not against an entity.
export function validateProjectionDetailScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: ProjectionDetailScreenDefinition,
): void {
  const featureName = ctx.feature.name;
  rejectMissingQuery(featureName, screenId, "projectionDetail", screen.query);
  validateProjectionDetailFlags(featureName, screenId, screen);
  rejectEmptySections(featureName, screenId, "projectionDetail", screen.layout.sections.length);
  validateProjectionDetailTabs(featureName, screenId, screen);
  for (const metric of screen.metrics ?? []) {
    validateProjectionDetailMetric(ctx, screenId, screen, metric);
  }
  validateProjectionDetailStatusTones(featureName, screenId, screen);
  validateProjectionDetailSubtitle(ctx, screenId, screen);
  for (const section of screen.layout.sections) {
    validateProjectionDetailSection(ctx, screenId, screen, section);
  }
  validatePrimaryActionTarget(featureName, screenId, screen);
  for (const action of screen.actions ?? []) {
    validateActionHasIcon(featureName, screenId, "projectionDetail", "action", action);
    validateRecordHeaderAction(ctx, screenId, "projectionDetail", screen.detailFor, action);
  }
}
