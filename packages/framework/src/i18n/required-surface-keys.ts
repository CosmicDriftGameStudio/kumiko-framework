import { isExplicitDotFormKey } from "../engine/i18n-key.js";
import type { FieldsOrGroupsSection } from "../engine/screen-helpers.js";
import {
  isExtensionEditSection,
  isWriteFormEditSection,
  normalizeListColumn,
  sectionFieldSpecs,
} from "../engine/screen-helpers.js";
import type {
  DashboardFilterDefinition,
  DashboardPanelDefinition,
  DashboardScreenDefinition,
  EntityListExpandableRow,
  FeatureDefinition,
  NavDefinition,
  RowAction,
  ScreenDefinition,
  SecretMintScreenDefinition,
  ToolbarAction,
  WorkspaceDefinition,
} from "../engine/types/index.js";

/** Pseudo-entity for actionForm field labels (renderer action-form-shim). */
export const ACTION_FORM_ENTITY = "__action-form__";

/** Pseudo-entity for configEdit field labels (renderer config-edit-shim). */
export const CONFIG_EDIT_ENTITY = "__config-edit__";

/** Pseudo-entity for projectionDetail field labels (renderer projection-detail-shim). */
export const PROJECTION_DETAIL_ENTITY = "__projection-detail__";

/** Pseudo-entity for a projectionDetail writeForm section's own fieldDefs
 *  (distinct from PROJECTION_DETAIL_ENTITY — the section's fields aren't
 *  drawn from the host record's display entity). */
export const WRITE_FORM_SECTION_ENTITY = "__write-form-section__";

export function fieldLabelKey(featureName: string, entityName: string, fieldName: string): string {
  return `${featureName}:entity:${entityName}:field:${fieldName}`;
}

export function booleanFacetOptionKeys(
  featureName: string,
  entityName: string,
  fieldName: string,
): readonly string[] {
  const base = `${featureName}:entity:${entityName}:field:${fieldName}:option`;
  return [`${base}:true`, `${base}:false`];
}

export function selectFacetOptionKey(
  featureName: string,
  entityName: string,
  fieldName: string,
  value: string,
): string {
  return `${featureName}:entity:${entityName}:field:${fieldName}:option:${value}`;
}

export function screenTitleKey(screenId: string): string {
  return `screen:${screenId}.title`;
}

function isI18nKey(value: string): boolean {
  return value.includes(":") || isExplicitDotFormKey(value);
}

/**
 * `treatAsKey` bypasses the colon-only `isI18nKey` check — used by the Settings-Hub
 * generator's dot-form labels (`${feature}.settings`, mask titles), which are
 * always i18n references by construction, never literal display text (fw#2260).
 * `isI18nKey` itself also accepts dot-form labels explicitly marked via `i18nKey()` (fw#2313).
 */
function pushKey(out: Set<string>, value: string | undefined, treatAsKey = false): void {
  if (value !== undefined && (treatAsKey || isI18nKey(value))) out.add(value);
}

function editFieldName(f: string | { readonly field: string }): string {
  return typeof f === "string" ? f : f.field;
}

// Group titles are translated exactly like the section title (computeEditViewModel).
function pushSectionTitles(
  out: Set<string>,
  section: { readonly title?: string; readonly subtitle?: string } & FieldsOrGroupsSection,
  treatAsKey = false,
): void {
  pushKey(out, section.title, treatAsKey);
  pushKey(out, section.subtitle, treatAsKey);
  for (const group of section.groups ?? []) pushKey(out, group.title, treatAsKey);
}

type ActionFormShapedStep = Pick<SecretMintScreenDefinition, "fields" | "layout">;

// Field labels and section titles of a step rendered through the action-form shim.
function pushActionFormShapedKeys(
  out: Set<string>,
  featureName: string,
  step: ActionFormShapedStep,
): void {
  for (const fieldName of Object.keys(step.fields)) {
    out.add(fieldLabelKey(featureName, ACTION_FORM_ENTITY, fieldName));
  }
  for (const section of step.layout.sections) {
    if (isExtensionEditSection(section)) {
      pushKey(out, section.title);
      continue;
    }
    if (section.kind === "relatedList") continue; // rejected at boot, unreachable here
    pushSectionTitles(out, section);
    for (const f of sectionFieldSpecs(section)) {
      out.add(fieldLabelKey(featureName, ACTION_FORM_ENTITY, editFieldName(f)));
    }
  }
}

function pushRowActionKeys(out: Set<string>, action: RowAction): void {
  pushKey(out, action.label);
  if (action.kind === "writeHandler" || action.kind === undefined) {
    pushKey(out, action.confirm);
    pushKey(out, action.confirmLabel);
  }
  if (action.kind === "drawer") {
    pushKey(out, action.title);
    pushKey(out, action.subtitle);
  }
}

function pushDashboardScreenKeys(out: Set<string>, dashboard: DashboardScreenDefinition): void {
  for (const panel of dashboard.panels) pushDashboardPanelKeys(out, panel);
  if (dashboard.filter !== undefined) pushDashboardFilterKeys(out, dashboard.filter);
  for (const option of dashboard.timeRange?.options ?? []) pushKey(out, option.label);
  pushKey(out, dashboard.scope?.badge);
  pushKey(out, dashboard.scope?.notice);
}

function pushDashboardPanelKeys(out: Set<string>, panel: DashboardPanelDefinition): void {
  // skip: custom-Panel übersetzt sich selbst, kein Key hier
  if (panel.kind === "custom") return;
  pushKey(out, panel.label);
  if (panel.kind === "chart" || panel.kind === "stat-group") pushKey(out, panel.subtitle);
  if (panel.kind === "chart") {
    for (const option of panel.ranges?.options ?? []) pushKey(out, option.label);
  }
  if (
    panel.kind === "chart" ||
    panel.kind === "list" ||
    panel.kind === "feed" ||
    panel.kind === "progress-list"
  ) {
    pushKey(out, panel.emptyLabel);
    pushKey(out, panel.emptyHint);
  }
  if (panel.kind === "stat-group") {
    for (const stat of panel.stats) pushKey(out, stat.label);
  }
  if (panel.kind === "list") {
    for (const col of panel.columns) {
      const normalized = normalizeListColumn(col);
      if (normalized.label !== undefined) pushKey(out, normalized.label);
    }
  }
}

function pushDashboardFilterKeys(out: Set<string>, filter: DashboardFilterDefinition): void {
  pushKey(out, filter.label);
  if (filter.allLabel !== undefined) pushKey(out, filter.allLabel);
  if (filter.placeholder !== undefined) pushKey(out, filter.placeholder);
  for (const opt of filter.options ?? []) pushKey(out, opt.label);
}

function pushToolbarActionKeys(out: Set<string>, action: ToolbarAction): void {
  pushKey(out, action.label);
  if (action.kind === "writeHandler") {
    pushKey(out, action.confirm);
    pushKey(out, action.confirmLabel);
  }
  // drawer-kind carries no confirm/confirmLabel — action.label is the
  // toolbar button and the Drawer title unless `title` overrides it.
  if (action.kind === "drawer") {
    pushKey(out, action.title);
    pushKey(out, action.subtitle);
  }
}

function pushRelatedListSectionKeys(out: Set<string>, section: EntityListExpandableRow): void {
  pushKey(out, section.title);
  pushKey(out, section.description);
  pushKey(out, section.itemNoun);
  for (const col of section.columns) {
    const normalized = normalizeListColumn(col);
    if (normalized.label !== undefined) pushKey(out, normalized.label);
  }
  for (const action of section.rowActions ?? []) pushRowActionKeys(out, action);
  pushKey(out, section.groupBy?.label);
  for (const label of Object.values(section.groupBy?.labels ?? {})) pushKey(out, label);
}

function pushExpandableRowKeys(out: Set<string>, section: EntityListExpandableRow): void {
  pushRelatedListSectionKeys(out, section);
  for (const action of section.actions ?? []) pushRowActionKeys(out, action);
  for (const action of section.toolbarActions ?? []) pushToolbarActionKeys(out, action);
  pushKey(out, section.emptyState?.title);
  pushKey(out, section.emptyState?.description);
  if (section.emptyState?.action !== undefined) {
    pushRowActionKeys(out, section.emptyState.action);
  }
}

export type RequiredKeysOptions = {
  /** Bypass `isI18nKey`'s colon-only check for generated dot-form labels (fw#2260). */
  readonly treatDotFormAsKey?: boolean;
};

export function requiredKeysFromScreen(
  featureName: string,
  screen: ScreenDefinition,
  options: RequiredKeysOptions = {},
): readonly string[] {
  const { treatDotFormAsKey = false } = options;
  const out = new Set<string>();
  pushKey(out, screenTitleKey(screen.id));

  switch (screen.type) {
    case "entityList": {
      const list = screen;
      for (const col of list.columns) {
        const normalized = normalizeListColumn(col);
        if (normalized.label !== undefined) {
          pushKey(out, normalized.label);
        } else {
          out.add(fieldLabelKey(featureName, list.entity, normalized.field));
        }
      }
      pushKey(out, list.createLabel);
      pushKey(out, list.searchPlaceholder);
      for (const action of list.rowActions ?? []) pushRowActionKeys(out, action);
      for (const action of list.toolbarActions ?? []) pushToolbarActionKeys(out, action);
      if (list.expandableRow !== undefined) pushExpandableRowKeys(out, list.expandableRow);
      break;
    }
    case "projectionList": {
      const list = screen;
      // Keine Entity → keine field-label-Fallbacks; nur explizite Column-Labels.
      for (const col of list.columns) {
        const normalized = normalizeListColumn(col);
        if (normalized.label !== undefined) pushKey(out, normalized.label);
      }
      pushKey(out, list.createLabel);
      pushKey(out, list.searchPlaceholder);
      for (const action of list.rowActions ?? []) pushRowActionKeys(out, action);
      for (const action of list.toolbarActions ?? []) pushToolbarActionKeys(out, action);
      break;
    }
    case "dashboard": {
      pushDashboardScreenKeys(out, screen);
      break;
    }
    case "entityEdit": {
      const edit = screen;
      pushKey(out, edit.submitLabel);
      pushKey(out, edit.titleTemplate);
      for (const section of edit.layout.sections) {
        if (isExtensionEditSection(section)) {
          pushKey(out, section.title);
          continue;
        }
        if (section.kind === "relatedList") continue; // rejected at boot, unreachable here
        pushSectionTitles(out, section);
        for (const f of sectionFieldSpecs(section)) {
          const fieldName = editFieldName(f);
          const override = edit.fieldLabels?.[fieldName];
          if (override !== undefined) pushKey(out, override);
          else out.add(fieldLabelKey(featureName, edit.entity, fieldName));
        }
      }
      break;
    }
    case "actionForm": {
      const form = screen;
      pushKey(out, form.submitLabel);
      pushKey(out, form.summary?.title);
      pushKey(out, form.summary?.subtitle);
      for (const action of form.footerActions ?? []) pushKey(out, action.label);
      for (const fieldName of Object.keys(form.fields)) {
        const override = form.fieldLabels?.[fieldName];
        if (override !== undefined) pushKey(out, override);
        else out.add(fieldLabelKey(featureName, ACTION_FORM_ENTITY, fieldName));
      }
      for (const section of form.layout.sections) {
        if (isExtensionEditSection(section)) {
          pushKey(out, section.title);
          continue;
        }
        if (section.kind === "relatedList") continue; // rejected at boot, unreachable here
        pushSectionTitles(out, section);
        for (const f of sectionFieldSpecs(section)) {
          const fieldName = editFieldName(f);
          const override = form.fieldLabels?.[fieldName];
          if (override !== undefined) pushKey(out, override);
          else out.add(fieldLabelKey(featureName, ACTION_FORM_ENTITY, fieldName));
        }
      }
      break;
    }
    case "secretMint": {
      const mint = screen;
      pushKey(out, mint.submitLabel);
      pushActionFormShapedKeys(out, featureName, mint);
      pushKey(out, mint.reveal.title);
      pushKey(out, mint.reveal.warning);
      pushKey(out, mint.reveal.confirmLabel);
      for (const revealField of mint.reveal.fields) {
        pushKey(out, revealField.label);
      }
      if (mint.confirm !== undefined) {
        pushKey(out, mint.confirm.submitLabel);
        pushKey(out, mint.confirm.doneMessage);
        pushActionFormShapedKeys(out, featureName, mint.confirm);
      }
      break;
    }
    case "configEdit": {
      const config = screen;
      pushKey(out, config.submitLabel);
      pushKey(out, config.description, treatDotFormAsKey);
      for (const key of Object.values(config.fieldDescriptions ?? {})) {
        pushKey(out, key, treatDotFormAsKey);
      }
      for (const fieldName of Object.keys(config.fields)) {
        const override = config.fieldLabels?.[fieldName];
        if (override !== undefined) pushKey(out, override, treatDotFormAsKey);
        else out.add(fieldLabelKey(featureName, CONFIG_EDIT_ENTITY, fieldName));
      }
      for (const section of config.layout.sections) {
        if (isExtensionEditSection(section)) {
          pushKey(out, section.title);
          continue;
        }
        if (section.kind === "relatedList") continue; // rejected at boot, unreachable here
        pushSectionTitles(out, section, treatDotFormAsKey);
        pushKey(out, section.description, treatDotFormAsKey);
        for (const f of sectionFieldSpecs(section)) {
          const fieldName = editFieldName(f);
          const override = config.fieldLabels?.[fieldName];
          if (override !== undefined) pushKey(out, override, treatDotFormAsKey);
          else out.add(fieldLabelKey(featureName, CONFIG_EDIT_ENTITY, fieldName));
        }
      }
      break;
    }
    case "secretsEdit": {
      const secretsEdit = screen;
      for (const key of Object.values(secretsEdit.fieldLabels))
        pushKey(out, key, treatDotFormAsKey);
      for (const key of Object.values(secretsEdit.fieldHints ?? {})) {
        pushKey(out, key, treatDotFormAsKey);
      }
      for (const section of secretsEdit.sections) pushKey(out, section.title, treatDotFormAsKey);
      break;
    }
    case "projectionDetail": {
      const detail = screen;
      for (const section of detail.layout.sections) {
        if (isExtensionEditSection(section)) {
          pushKey(out, section.title);
          continue;
        }
        if (section.kind === "relatedList") {
          pushRelatedListSectionKeys(out, section);
          continue;
        }
        if (isWriteFormEditSection(section)) {
          pushKey(out, section.title);
          pushKey(out, section.description);
          pushKey(out, section.submitLabel);
          // kumiko-lint-ignore section-fields-raw writeForm sections carry no groups (EditWriteFormSection)
          for (const f of section.fields) {
            const fieldName = editFieldName(f);
            out.add(fieldLabelKey(featureName, WRITE_FORM_SECTION_ENTITY, fieldName));
          }
          continue;
        }
        pushSectionTitles(out, section);
        for (const f of sectionFieldSpecs(section)) {
          const fieldName = editFieldName(f);
          const override = detail.fieldLabels?.[fieldName];
          if (override !== undefined) pushKey(out, override);
          else out.add(fieldLabelKey(featureName, PROJECTION_DETAIL_ENTITY, fieldName));
        }
      }
      break;
    }
    case "custom":
      break;
  }

  return [...out];
}

export function requiredKeysFromNav(
  nav: NavDefinition,
  options: RequiredKeysOptions = {},
): readonly string[] {
  const out = new Set<string>();
  pushKey(out, nav.label, options.treatDotFormAsKey ?? false);
  return [...out];
}

export function requiredKeysFromWorkspace(ws: WorkspaceDefinition): readonly string[] {
  const out = new Set<string>();
  pushKey(out, ws.label);
  return [...out];
}

function collectEntityListFilterKeys(feature: FeatureDefinition, out: Set<string>): void {
  for (const screen of Object.values(feature.screens)) {
    if (screen.type !== "entityList") continue;
    const entity = feature.entities?.[screen.entity];
    if (!entity) continue;
    for (const [fieldName, rawDef] of Object.entries(entity.fields)) {
      const def = rawDef as {
        readonly filterable?: boolean;
        readonly type?: string;
        readonly options?: readonly string[];
      };
      if (def.filterable !== true) continue;
      if (def.type === "boolean") {
        for (const key of booleanFacetOptionKeys(feature.name, screen.entity, fieldName)) {
          out.add(key);
        }
      } else if (
        (def.type === "select" || def.type === "multiSelect") &&
        Array.isArray(def.options)
      ) {
        for (const value of def.options) {
          out.add(selectFacetOptionKey(feature.name, screen.entity, fieldName, value));
        }
      }
    }
  }
}

export function featureHasI18nSurface(feature: FeatureDefinition): boolean {
  if (Object.keys(feature.screens).length > 0) return true;
  if (Object.keys(feature.navs).length > 0) return true;
  if (Object.keys(feature.workspaces).length > 0) return true;
  for (const def of Object.values(feature.configKeys)) {
    if (def.mask !== undefined) return true;
  }
  return false;
}

export function requiredKeysFromFeature(feature: FeatureDefinition): readonly string[] {
  const out = new Set<string>();

  for (const screen of Object.values(feature.screens)) {
    for (const key of requiredKeysFromScreen(feature.name, screen)) out.add(key);
  }
  for (const nav of Object.values(feature.navs)) {
    for (const key of requiredKeysFromNav(nav)) out.add(key);
  }
  for (const ws of Object.values(feature.workspaces)) {
    for (const key of requiredKeysFromWorkspace(ws)) out.add(key);
  }
  for (const def of Object.values(feature.configKeys)) {
    // mask.title is always an i18n key by construction (ConfigKeyDefinition contract), not literal text.
    pushKey(out, def.mask?.title, true);
  }
  collectEntityListFilterKeys(feature, out);

  return [...out];
}

/** Effective lookup keys — mirrors registry merge (`feature:localKey` + raw full keys). */
export function buildEffectiveTranslationKeys(features: readonly FeatureDefinition[]): Set<string> {
  const out = new Set<string>();
  for (const feature of features) {
    for (const key of Object.keys(feature.translations ?? {})) {
      out.add(`${feature.name}:${key}`);
      // Blank form too — Settings-Hub group namespaces (`group: "tenant-settings"`)
      // require `${group}.settings` which is not `${feature}:${key}` (fw#2314).
      out.add(key);
    }
  }
  return out;
}

export type TranslationLocaleGap = {
  readonly featureName: string;
  readonly key: string;
  readonly missingLocales: readonly string[];
};

/** Locale completeness is opt-in via @cosmicdrift/kumiko-locale-* packages. */
export function findTranslationLocaleGaps(
  _features: readonly FeatureDefinition[],
): readonly TranslationLocaleGap[] {
  return [];
}
