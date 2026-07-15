import type {
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  DashboardFilterDefinition,
  DashboardPanelDefinition,
  DashboardScreenDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  FeatureDefinition,
  NavDefinition,
  ProjectionListScreenDefinition,
  RowAction,
  ScreenDefinition,
  ToolbarAction,
  WorkspaceDefinition,
} from "../engine/types";
import { isExtensionEditSection, normalizeListColumn } from "../engine/types/screen";

/** Pseudo-entity for actionForm field labels (renderer action-form-shim). */
export const ACTION_FORM_ENTITY = "__action-form__";

/** Pseudo-entity for configEdit field labels (renderer config-edit-shim). */
export const CONFIG_EDIT_ENTITY = "__config-edit__";

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
  return value.includes(":");
}

function pushKey(out: Set<string>, value: string | undefined): void {
  if (value !== undefined && isI18nKey(value)) out.add(value);
}

function editFieldName(f: string | { readonly field: string }): string {
  return typeof f === "string" ? f : f.field;
}

function pushRowActionKeys(out: Set<string>, action: RowAction): void {
  pushKey(out, action.label);
  if (action.kind === "writeHandler" || action.kind === undefined) {
    pushKey(out, action.confirm);
    pushKey(out, action.confirmLabel);
  }
}

function pushDashboardScreenKeys(out: Set<string>, dashboard: DashboardScreenDefinition): void {
  for (const panel of dashboard.panels) pushDashboardPanelKeys(out, panel);
  if (dashboard.filter !== undefined) pushDashboardFilterKeys(out, dashboard.filter);
}

function pushDashboardPanelKeys(out: Set<string>, panel: DashboardPanelDefinition): void {
  // skip: custom-Panel übersetzt sich selbst, kein Key hier
  if (panel.kind === "custom") return;
  pushKey(out, panel.label);
  if (panel.kind === "stat-group") {
    for (const stat of panel.stats) pushKey(out, stat.label);
  }
  if (panel.kind === "list") {
    for (const col of panel.columns) {
      const normalized = normalizeListColumn(col);
      if (normalized.label !== undefined) pushKey(out, normalized.label);
    }
  }
  if (panel.kind === "feed" && panel.emptyLabel !== undefined) pushKey(out, panel.emptyLabel);
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
}

export function requiredKeysFromScreen(
  featureName: string,
  screen: ScreenDefinition,
): readonly string[] {
  const out = new Set<string>();
  pushKey(out, screenTitleKey(screen.id));

  switch (screen.type) {
    case "entityList": {
      const list = screen as EntityListScreenDefinition;
      for (const col of list.columns) {
        const normalized = normalizeListColumn(col);
        if (normalized.label !== undefined) {
          pushKey(out, normalized.label);
        } else {
          out.add(fieldLabelKey(featureName, list.entity, normalized.field));
        }
      }
      for (const action of list.rowActions ?? []) pushRowActionKeys(out, action);
      for (const action of list.toolbarActions ?? []) pushToolbarActionKeys(out, action);
      break;
    }
    case "projectionList": {
      const list = screen as ProjectionListScreenDefinition;
      // Keine Entity → keine field-label-Fallbacks; nur explizite Column-Labels.
      for (const col of list.columns) {
        const normalized = normalizeListColumn(col);
        if (normalized.label !== undefined) pushKey(out, normalized.label);
      }
      for (const action of list.rowActions ?? []) pushRowActionKeys(out, action);
      for (const action of list.toolbarActions ?? []) pushToolbarActionKeys(out, action);
      break;
    }
    case "dashboard": {
      pushDashboardScreenKeys(out, screen as DashboardScreenDefinition);
      break;
    }
    case "entityEdit": {
      const edit = screen as EntityEditScreenDefinition;
      pushKey(out, edit.submitLabel);
      for (const section of edit.layout.sections) {
        if (isExtensionEditSection(section)) {
          pushKey(out, section.title);
          continue;
        }
        pushKey(out, section.title);
        for (const f of section.fields) {
          const fieldName = editFieldName(f);
          const override = edit.fieldLabels?.[fieldName];
          if (override !== undefined) pushKey(out, override);
          else out.add(fieldLabelKey(featureName, edit.entity, fieldName));
        }
      }
      break;
    }
    case "actionForm": {
      const form = screen as ActionFormScreenDefinition;
      pushKey(out, form.submitLabel);
      for (const fieldName of Object.keys(form.fields)) {
        out.add(fieldLabelKey(featureName, ACTION_FORM_ENTITY, fieldName));
      }
      for (const section of form.layout.sections) {
        if (isExtensionEditSection(section)) {
          pushKey(out, section.title);
          continue;
        }
        pushKey(out, section.title);
        for (const f of section.fields) {
          const fieldName = editFieldName(f);
          out.add(fieldLabelKey(featureName, ACTION_FORM_ENTITY, fieldName));
        }
      }
      break;
    }
    case "configEdit": {
      const config = screen as ConfigEditScreenDefinition;
      pushKey(out, config.submitLabel);
      for (const fieldName of Object.keys(config.fields)) {
        const override = config.fieldLabels?.[fieldName];
        if (override !== undefined) pushKey(out, override);
        else out.add(fieldLabelKey(featureName, CONFIG_EDIT_ENTITY, fieldName));
      }
      for (const section of config.layout.sections) {
        if (isExtensionEditSection(section)) {
          pushKey(out, section.title);
          continue;
        }
        pushKey(out, section.title);
        for (const f of section.fields) {
          const fieldName = editFieldName(f);
          const override = config.fieldLabels?.[fieldName];
          if (override !== undefined) pushKey(out, override);
          else out.add(fieldLabelKey(featureName, CONFIG_EDIT_ENTITY, fieldName));
        }
      }
      break;
    }
    case "custom":
      break;
  }

  return [...out];
}

export function requiredKeysFromNav(nav: NavDefinition): readonly string[] {
  const out = new Set<string>();
  pushKey(out, nav.label);
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
      } else if (def.type === "select" && Array.isArray(def.options)) {
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
    pushKey(out, def.mask?.title);
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
      if (key.includes(":")) out.add(key);
    }
  }
  return out;
}

export type TranslationLocaleGap = {
  readonly featureName: string;
  readonly key: string;
  readonly missingLocales: readonly string[];
};

const REQUIRED_LOCALES = ["de", "en"] as const;

export function findTranslationLocaleGaps(
  features: readonly FeatureDefinition[],
): readonly TranslationLocaleGap[] {
  const gaps: TranslationLocaleGap[] = [];
  for (const feature of features) {
    for (const [localKey, entry] of Object.entries(feature.translations ?? {})) {
      const missing = REQUIRED_LOCALES.filter((locale) => (entry[locale] ?? "").length === 0);
      if (missing.length > 0) {
        gaps.push({
          featureName: feature.name,
          key: localKey,
          missingLocales: missing,
        });
      }
    }
  }
  return gaps;
}
