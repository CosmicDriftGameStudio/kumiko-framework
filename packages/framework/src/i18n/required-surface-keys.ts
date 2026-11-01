import type { NavDefinition } from "@cosmicdrift/kumiko-types/nav";
import type {
  DashboardChartPanel,
  DashboardFilterDefinition,
  DashboardPanelDefinition,
  DashboardScreenDefinition,
  DashboardTextPanel,
  EditFieldSpec,
  EditRelatedListSection,
  EditWriteFormSection,
  EntityListExpandableRow,
  ListEmptyStateSpec,
  RowAction,
  ScreenDefinition,
  SecretMintScreenDefinition,
  ToolbarAction,
} from "@cosmicdrift/kumiko-types/screen";
import type { WorkspaceDefinition } from "@cosmicdrift/kumiko-types/workspace";
import { isExplicitDotFormKey } from "../engine/i18n-key.ts";
import type { FieldsOrGroupsSection } from "../engine/screen-helpers.ts";
import {
  isExtensionEditSection,
  isWriteFormEditSection,
  normalizeListColumn,
  sectionFieldSpecs,
} from "../engine/screen-helpers.ts";
import type { ScreenKind, ScreenOfKind } from "../engine/screen-kind.ts";
import type { FieldDefinition } from "../engine/types/fields.ts";
import type { FeatureDefinition } from "../engine/types/index.ts";

import type { TranslationValue } from "../ui-types/plural.ts";

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

export function handlerTitleKey(handlerQn: string): string {
  return `${handlerQn}:title`;
}

export function handlerDescriptionKey(handlerQn: string): string {
  return `${handlerQn}:description`;
}

// `feature:name` becomes `feature:webhook:name`, so the keys never collide with handler keys.
function webhookEventKeyBase(webhookEventQn: string): string {
  const separator = webhookEventQn.indexOf(":");
  return `${webhookEventQn.slice(0, separator)}:webhook:${webhookEventQn.slice(separator + 1)}`;
}

export function webhookEventDescriptionKey(webhookEventQn: string): string {
  return `${webhookEventKeyBase(webhookEventQn)}:description`;
}

/** `fieldPath` is the payload row name as the docs list it, nested fields dotted. */
export function webhookEventFieldKey(webhookEventQn: string, fieldPath: string): string {
  return `${webhookEventKeyBase(webhookEventQn)}:field:${fieldPath}`;
}

export function handlerFieldLabelKey(handlerQn: string, fieldName: string): string {
  return `${handlerQn}:field:${fieldName}`;
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
 * always i18n references by construction, never literal display text.
 * `isI18nKey` itself also accepts dot-form labels explicitly marked via `i18nKey()`.
 */
function pushKey(out: Set<string>, value: string | undefined, treatAsKey = false): void {
  if (value !== undefined && (treatAsKey || isI18nKey(value))) out.add(value);
}

function editFieldName(f: string | { readonly field: string }): string {
  return typeof f === "string" ? f : f.field;
}

// Placeholder, affix texts and the fill button label of a field spec; a `{ field }`
// affix reads another form field and is no key.
function pushEditFieldTextKeys(out: Set<string>, spec: EditFieldSpec, treatAsKey = false): void {
  // skip: shorthand field name carries no texts
  if (typeof spec === "string") return;
  pushKey(out, spec.placeholder, treatAsKey);
  for (const affix of [spec.prefix, spec.suffix]) {
    if (typeof affix === "string") pushKey(out, affix, treatAsKey);
  }
  pushKey(out, spec.fillAction?.label, treatAsKey);
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
      pushEditFieldTextKeys(out, f);
    }
  }
}

function pushRowActionKeys(out: Set<string>, action: RowAction): void {
  pushKey(out, action.label);
  if (
    action.kind === "writeHandler" ||
    action.kind === "clientAction" ||
    action.kind === undefined
  ) {
    pushKey(out, action.confirm);
    pushKey(out, action.confirmLabel);
  }
  if (action.kind === "clientAction") pushKey(out, action.successMessage);
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
  for (const action of dashboard.actions ?? []) pushRowActionKeys(out, action);
}

function pushDashboardPanelKeys(out: Set<string>, panel: DashboardPanelDefinition): void {
  // skip: custom panels translate themselves, so no key is collected here
  if (panel.kind === "custom") return;
  pushKey(out, panel.label);
  if (panel.kind === "chart" || panel.kind === "stat-group") pushKey(out, panel.subtitle);
  if (panel.kind === "text") pushDashboardTextBlockKeys(out, panel);
  if (panel.kind === "chart") {
    pushKey(out, panel.unit);
    pushDashboardChartRangeKeys(out, panel);
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
  pushDashboardChildLabelKeys(out, panel);
}

function pushDashboardChildLabelKeys(out: Set<string>, panel: DashboardPanelDefinition): void {
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

function pushDashboardTextBlockKeys(out: Set<string>, panel: DashboardTextPanel): void {
  for (const block of panel.blocks) {
    // skip: code is shown verbatim, not translated
    if (block.kind === "code") continue;
    if (block.kind === "list") {
      for (const item of block.items) pushKey(out, item);
    } else {
      pushKey(out, block.text);
    }
  }
}

function pushDashboardChartRangeKeys(out: Set<string>, panel: DashboardChartPanel): void {
  for (const option of panel.ranges?.options ?? []) pushKey(out, option.label);
  for (const kind of Object.values(panel.markerKinds ?? {})) pushKey(out, kind.label);
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

function pushRelatedListSectionKeys(
  out: Set<string>,
  section: EntityListExpandableRow | EditRelatedListSection,
): void {
  pushKey(out, section.title);
  pushKey(out, section.description);
  pushKey(out, section.itemNoun);
  for (const col of section.columns) {
    const normalized = normalizeListColumn(col);
    if (normalized.label !== undefined) pushKey(out, normalized.label);
  }
  for (const action of section.rowActions ?? []) pushRowActionKeys(out, action);
  const grouping = section.table?.grouping;
  pushKey(out, grouping?.label);
  for (const label of Object.values<string>(grouping?.labels ?? {})) pushKey(out, label);
  for (const variant of section.emptyState?.variants ?? []) {
    pushKey(out, variant.title);
    pushKey(out, variant.description);
  }
}

function pushListEmptyStateKeys(
  out: Set<string>,
  emptyState: ListEmptyStateSpec | undefined,
): void {
  pushKey(out, emptyState?.title);
  pushKey(out, emptyState?.description);
  if (emptyState?.action !== undefined) pushRowActionKeys(out, emptyState.action);
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

type ScreenKeyCollectorContext = {
  readonly out: Set<string>;
  readonly featureName: string;
  readonly treatDotFormAsKey: boolean;
};

type ScreenKeyCollectors = {
  readonly [K in ScreenKind]: (ctx: ScreenKeyCollectorContext, screen: ScreenOfKind[K]) => void;
};

type FieldLabelOverrides = Readonly<Record<string, string>> | undefined;

function pushFieldLabelOrOverrideKey(
  ctx: ScreenKeyCollectorContext,
  labelEntity: string,
  fieldName: string,
  fieldLabels: FieldLabelOverrides,
  treatAsKey = false,
): void {
  const override = fieldLabels?.[fieldName];
  if (override !== undefined) pushKey(ctx.out, override, treatAsKey);
  else ctx.out.add(fieldLabelKey(ctx.featureName, labelEntity, fieldName));
}

function pushListChromeKeys(
  out: Set<string>,
  list: ScreenOfKind["entityList"] | ScreenOfKind["projectionList"],
): void {
  pushKey(out, list.createLabel);
  pushKey(out, list.searchPlaceholder);
  pushKey(out, list.description);
  pushListEmptyStateKeys(out, list.emptyState);
  for (const action of list.rowActions ?? []) pushRowActionKeys(out, action);
  for (const action of list.toolbarActions ?? []) pushToolbarActionKeys(out, action);
  for (const bulk of list.bulkActions ?? []) pushKey(out, bulk.confirm);
}

function collectEntityListKeys(
  ctx: ScreenKeyCollectorContext,
  list: ScreenOfKind["entityList"],
): void {
  for (const col of list.columns) {
    const normalized = normalizeListColumn(col);
    if (normalized.label !== undefined) {
      pushKey(ctx.out, normalized.label);
    } else {
      ctx.out.add(fieldLabelKey(ctx.featureName, list.entity, normalized.field));
    }
  }
  pushListChromeKeys(ctx.out, list);
  if (list.expandableRow !== undefined) pushExpandableRowKeys(ctx.out, list.expandableRow);
}

function collectProjectionListKeys(
  ctx: ScreenKeyCollectorContext,
  list: ScreenOfKind["projectionList"],
): void {
  // No entity means there are no field-label fallbacks; only explicit column labels are
  // collected.
  for (const col of list.columns) {
    const normalized = normalizeListColumn(col);
    if (normalized.label !== undefined) pushKey(ctx.out, normalized.label);
  }
  pushListChromeKeys(ctx.out, list);
}

function pushEditLayoutSectionKeys(
  ctx: ScreenKeyCollectorContext,
  sections: ScreenOfKind["entityEdit"]["layout"]["sections"],
  labelEntity: string,
  fieldLabels: FieldLabelOverrides,
): void {
  for (const section of sections) {
    if (isExtensionEditSection(section)) {
      pushKey(ctx.out, section.title);
      continue;
    }
    if (section.kind === "relatedList") continue; // rejected at boot, unreachable here
    pushSectionTitles(ctx.out, section);
    for (const f of sectionFieldSpecs(section)) {
      pushEditFieldTextKeys(ctx.out, f);
      pushFieldLabelOrOverrideKey(ctx, labelEntity, editFieldName(f), fieldLabels);
    }
  }
}

function collectEntityEditKeys(
  ctx: ScreenKeyCollectorContext,
  edit: ScreenOfKind["entityEdit"],
): void {
  pushKey(ctx.out, edit.submitLabel);
  pushKey(ctx.out, edit.titleTemplate);
  pushEditLayoutSectionKeys(ctx, edit.layout.sections, edit.entity, edit.fieldLabels);
}

function collectActionFormKeys(
  ctx: ScreenKeyCollectorContext,
  form: ScreenOfKind["actionForm"],
): void {
  pushKey(ctx.out, form.submitLabel);
  pushKey(ctx.out, form.summary?.title);
  pushKey(ctx.out, form.summary?.subtitle);
  for (const action of form.footerActions ?? []) pushKey(ctx.out, action.label);
  for (const link of form.successLinks ?? []) pushKey(ctx.out, link.label);
  for (const fact of form.successFacts ?? []) pushKey(ctx.out, fact.label);
  pushKey(ctx.out, form.successItems?.link?.label);
  for (const fieldName of Object.keys(form.fields)) {
    pushFieldLabelOrOverrideKey(ctx, ACTION_FORM_ENTITY, fieldName, form.fieldLabels);
  }
  pushEditLayoutSectionKeys(ctx, form.layout.sections, ACTION_FORM_ENTITY, form.fieldLabels);
}

function collectSecretMintKeys(
  ctx: ScreenKeyCollectorContext,
  mint: ScreenOfKind["secretMint"],
): void {
  const { out, featureName } = ctx;
  pushKey(out, mint.submitLabel);
  pushActionFormShapedKeys(out, featureName, mint);
  pushKey(out, mint.reveal.title);
  pushKey(out, mint.reveal.warning);
  pushKey(out, mint.reveal.confirmLabel);
  pushKey(out, mint.reveal.acknowledge);
  for (const revealField of mint.reveal.fields) {
    pushKey(out, revealField.label);
  }
  if (mint.confirm !== undefined) {
    pushKey(out, mint.confirm.submitLabel);
    pushKey(out, mint.confirm.doneMessage);
    pushActionFormShapedKeys(out, featureName, mint.confirm);
  }
}

function pushConfigEditSectionKeys(
  ctx: ScreenKeyCollectorContext,
  config: ScreenOfKind["configEdit"],
): void {
  const { out, treatDotFormAsKey } = ctx;
  for (const section of config.layout.sections) {
    if (isExtensionEditSection(section)) {
      pushKey(out, section.title);
      continue;
    }
    if (section.kind === "relatedList") continue; // rejected at boot, unreachable here
    pushSectionTitles(out, section, treatDotFormAsKey);
    pushKey(out, section.description, treatDotFormAsKey);
    for (const f of sectionFieldSpecs(section)) {
      pushEditFieldTextKeys(out, f, treatDotFormAsKey);
      pushFieldLabelOrOverrideKey(
        ctx,
        CONFIG_EDIT_ENTITY,
        editFieldName(f),
        config.fieldLabels,
        treatDotFormAsKey,
      );
    }
  }
}

function collectConfigEditKeys(
  ctx: ScreenKeyCollectorContext,
  config: ScreenOfKind["configEdit"],
): void {
  const { out, treatDotFormAsKey } = ctx;
  pushKey(out, config.submitLabel);
  pushKey(out, config.description, treatDotFormAsKey);
  for (const key of Object.values(config.fieldDescriptions ?? {})) {
    pushKey(out, key, treatDotFormAsKey);
  }
  for (const fieldName of Object.keys(config.fields)) {
    pushFieldLabelOrOverrideKey(
      ctx,
      CONFIG_EDIT_ENTITY,
      fieldName,
      config.fieldLabels,
      treatDotFormAsKey,
    );
  }
  pushConfigEditSectionKeys(ctx, config);
}

function collectSecretsEditKeys(
  ctx: ScreenKeyCollectorContext,
  secretsEdit: ScreenOfKind["secretsEdit"],
): void {
  const { out, treatDotFormAsKey } = ctx;
  for (const key of Object.values(secretsEdit.fieldLabels)) pushKey(out, key, treatDotFormAsKey);
  for (const key of Object.values(secretsEdit.fieldHints ?? {})) {
    pushKey(out, key, treatDotFormAsKey);
  }
  for (const section of secretsEdit.sections) pushKey(out, section.title, treatDotFormAsKey);
}

function pushWriteFormSectionKeys(
  ctx: ScreenKeyCollectorContext,
  section: EditWriteFormSection,
): void {
  pushKey(ctx.out, section.title);
  pushKey(ctx.out, section.description);
  pushKey(ctx.out, section.submitLabel);
  for (const f of section.fields) {
    pushEditFieldTextKeys(ctx.out, f);
    ctx.out.add(fieldLabelKey(ctx.featureName, WRITE_FORM_SECTION_ENTITY, editFieldName(f)));
  }
}

function collectProjectionDetailKeys(
  ctx: ScreenKeyCollectorContext,
  detail: ScreenOfKind["projectionDetail"],
): void {
  for (const metric of detail.metrics ?? []) pushKey(ctx.out, metric.label);
  for (const section of detail.layout.sections) {
    if (isExtensionEditSection(section)) {
      pushKey(ctx.out, section.title);
      continue;
    }
    if (section.kind === "relatedList") {
      pushRelatedListSectionKeys(ctx.out, section);
      for (const bulk of section.bulkActions ?? []) pushKey(ctx.out, bulk.confirm);
      continue;
    }
    if (isWriteFormEditSection(section)) {
      pushWriteFormSectionKeys(ctx, section);
      continue;
    }
    pushSectionTitles(ctx.out, section);
    for (const f of sectionFieldSpecs(section)) {
      pushEditFieldTextKeys(ctx.out, f);
      pushFieldLabelOrOverrideKey(
        ctx,
        PROJECTION_DETAIL_ENTITY,
        editFieldName(f),
        detail.fieldLabels,
      );
    }
  }
}

const SCREEN_KEY_COLLECTORS: ScreenKeyCollectors = {
  entityList: collectEntityListKeys,
  projectionList: collectProjectionListKeys,
  entityEdit: collectEntityEditKeys,
  actionForm: collectActionFormKeys,
  secretMint: collectSecretMintKeys,
  configEdit: collectConfigEditKeys,
  secretsEdit: collectSecretsEditKeys,
  projectionDetail: collectProjectionDetailKeys,
  dashboard: (ctx, screen) => pushDashboardScreenKeys(ctx.out, screen),
  // Custom screens translate their own texts.
  custom: () => {},
};

function collectScreenKeysOfKind<K extends ScreenKind>(
  ctx: ScreenKeyCollectorContext,
  kind: K,
  screen: ScreenOfKind[K],
): void {
  SCREEN_KEY_COLLECTORS[kind](ctx, screen);
}

export type RequiredKeysOptions = {
  /** Bypass `isI18nKey`'s colon-only check for generated dot-form labels. */
  readonly treatDotFormAsKey?: boolean;
};

export function requiredKeysFromScreen(
  featureName: string,
  screen: ScreenDefinition,
  options: RequiredKeysOptions = {},
): readonly string[] {
  const ctx: ScreenKeyCollectorContext = {
    out: new Set<string>(),
    featureName,
    treatDotFormAsKey: options.treatDotFormAsKey ?? false,
  };
  pushKey(ctx.out, screenTitleKey(screen.id));
  // An unknown type is only reachable by casting past ScreenDefinition and yields the title key alone.
  if (Object.hasOwn(SCREEN_KEY_COLLECTORS, screen.type)) {
    collectScreenKeysOfKind(ctx, screen.type, screen);
  }
  return [...ctx.out];
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
    for (const [fieldName, def] of Object.entries(entity.fields)) {
      if (!("filterable" in def) || def.filterable !== true) continue;
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
  for (const collection of Object.values(feature.contentCollections ?? {})) {
    pushKey(out, collection.nav.entryLabel);
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
      // require `${group}.settings` which is not `${feature}:${key}`.
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

function hasLocaleValue(value: TranslationValue | undefined): boolean {
  if (value === undefined) return false;
  return typeof value === "string" ? value !== "" : true;
}

/**
 * Per feature, every translation key must carry every locale that any key of the
 * same feature carries. A feature with a single locale across all keys is
 * consistent by definition (locale packages, en-only framework features).
 */
export function findTranslationLocaleGaps(
  features: readonly FeatureDefinition[],
): readonly TranslationLocaleGap[] {
  const gaps: TranslationLocaleGap[] = [];
  for (const feature of features) {
    const entries = Object.entries(feature.translations ?? {});
    const featureLocales = new Set<string>();
    for (const [, byLocale] of entries) {
      for (const locale of Object.keys(byLocale)) featureLocales.add(locale);
    }
    if (featureLocales.size < 2) continue;
    const sortedLocales = [...featureLocales].sort();
    for (const [key, byLocale] of entries) {
      const missingLocales = sortedLocales.filter((locale) => !hasLocaleValue(byLocale[locale]));
      if (missingLocales.length > 0) gaps.push({ featureName: feature.name, key, missingLocales });
    }
  }
  return gaps;
}

const LOCALE_PACKAGE_PREFIX = "locale-";

export type RequiredLocaleGap = {
  readonly featureName: string;
  readonly key: string;
  readonly missingLocales: readonly string[];
};

function collectLocalesByName(
  features: readonly FeatureDefinition[],
): ReadonlyMap<string, ReadonlySet<string>> {
  // A plain key of a regular feature is only its own; registering it raw would let two
  // features with the same plain key cover each other's missing locales.
  const namesOf = (featureName: string, key: string): readonly string[] =>
    featureName.startsWith(LOCALE_PACKAGE_PREFIX) || key.includes(":")
      ? [`${featureName}:${key}`, key]
      : [`${featureName}:${key}`];
  const localesByName = new Map<string, Set<string>>();
  for (const feature of features) {
    for (const [key, byLocale] of Object.entries(feature.translations ?? {})) {
      const present = Object.entries(byLocale)
        .filter(([, value]) => hasLocaleValue(value))
        .map(([locale]) => locale);
      for (const name of namesOf(feature.name, key)) {
        const locales = localesByName.get(name) ?? new Set<string>();
        for (const locale of present) locales.add(locale);
        localesByName.set(name, locales);
      }
    }
  }
  return localesByName;
}

/**
 * Per translation key, the union of locales over ALL features must cover
 * `requiredLocales`. Locale packages translate other features' keys under the
 * full `feature:key` name, so the lookup unions by effective name. Raw names
 * only come from locale packages and already-prefixed keys. Entries that only translate another
 * mounted feature's key are not reported separately; the defining feature is.
 * Locale packages (`locale-*`) only contribute locales: their keys often belong to
 * client bundles (e.g. `auth.errors.*`) that no feature defines, so they are never
 * reported as gap owners.
 */
export function findRequiredLocaleGaps(
  features: readonly FeatureDefinition[],
  requiredLocales: readonly string[],
): readonly RequiredLocaleGap[] {
  const featureNames = new Set(features.map((feature) => feature.name));
  const localesByName = collectLocalesByName(features);
  const gaps: RequiredLocaleGap[] = [];
  const reported = new Set<string>();
  for (const feature of features) {
    if (feature.name.startsWith(LOCALE_PACKAGE_PREFIX)) continue;
    for (const key of Object.keys(feature.translations ?? {})) {
      const prefix = key.includes(":") ? key.slice(0, key.indexOf(":")) : undefined;
      const translatesOtherFeature =
        prefix !== undefined && prefix !== feature.name && featureNames.has(prefix);
      if (translatesOtherFeature) continue;
      const effective = key.includes(":") ? key : `${feature.name}:${key}`;
      if (reported.has(effective)) continue;
      // Locale packages spell plurals as flat `.one`/`.other` keys; `other` is the form every locale has.
      const present = new Set<string>(
        [effective, key, `${effective}.other`, `${key}.other`].flatMap((name) => [
          ...(localesByName.get(name) ?? []),
        ]),
      );
      const missingLocales = requiredLocales.filter((locale) => !present.has(locale));
      if (missingLocales.length > 0) {
        reported.add(effective);
        gaps.push({ featureName: feature.name, key, missingLocales });
      }
    }
  }
  return gaps;
}

export function embeddedCellLabelKey(
  featureName: string,
  entityName: string,
  fieldName: string,
  subFieldName: string,
): string {
  return `${fieldLabelKey(featureName, entityName, fieldName)}:cell:${subFieldName}`;
}

export function embeddedCellOptionLabelKey(
  featureName: string,
  entityName: string,
  fieldName: string,
  subFieldName: string,
  value: string,
): string {
  return `${embeddedCellLabelKey(featureName, entityName, fieldName, subFieldName)}:option:${value}`;
}

function pushFieldValueTranslationKeys(
  out: Set<string>,
  featureName: string,
  entityName: string,
  fieldName: string,
  def: FieldDefinition,
  includeEmbeddedCells: boolean,
): void {
  if (def.type === "select" || def.type === "multiSelect") {
    for (const value of def.options) {
      out.add(selectFacetOptionKey(featureName, entityName, fieldName, value));
    }
    // skip: option keys are complete, nothing else to collect for select fields
    return;
  }
  // skip: only multi-row embedded fields render cell labels
  if (!includeEmbeddedCells || def.type !== "embedded" || def.multiple !== true) return;
  for (const [subName, sub] of Object.entries(def.schema)) {
    out.add(embeddedCellLabelKey(featureName, entityName, fieldName, subName));
    if (sub.type !== "select") continue;
    for (const value of sub.options) {
      out.add(embeddedCellOptionLabelKey(featureName, entityName, fieldName, subName, value));
    }
  }
}

/** Keys for select option labels and embedded-list cells that the screens of one feature
 *  display. Opt-in via `requireFieldValueTranslations`: without them the renderer falls back
 *  to the raw option value or sub-field name. */
export function fieldValueTranslationKeysFromFeature(
  feature: FeatureDefinition,
): readonly string[] {
  const out = new Set<string>();
  for (const screen of Object.values(feature.screens)) {
    if (screen.type === "entityList") {
      const entity = feature.entities?.[screen.entity];
      if (!entity) continue;
      for (const col of screen.columns) {
        const { field } = normalizeListColumn(col);
        const def = entity.fields[field];
        if (def) pushFieldValueTranslationKeys(out, feature.name, screen.entity, field, def, false);
      }
    } else if (screen.type === "entityEdit") {
      const entity = feature.entities?.[screen.entity];
      if (!entity) continue;
      for (const section of screen.layout.sections) {
        if (isExtensionEditSection(section) || section.kind === "relatedList") continue;
        for (const spec of sectionFieldSpecs(section)) {
          const field = editFieldName(spec);
          const def = entity.fields[field];
          if (def)
            pushFieldValueTranslationKeys(out, feature.name, screen.entity, field, def, true);
        }
      }
    }
  }
  return [...out];
}
