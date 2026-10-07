// Screen validation, including the dashboard-panel sub-validators.
// Dashboard stays here (not a separate dashboard.ts) — validateScreens
// calls validateDashboardScreen and the dashboard validators call back
// into validateColumnRendererForm, splitting them would create a
// same-folder require cycle.

import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import type { OptionsQueryPayload } from "@cosmicdrift/kumiko-types/fields";
import {
  NO_WIDGET_FIELD_TYPES,
  optionsQueryFieldRefs,
  SELECT_OPTION_TONES,
} from "@cosmicdrift/kumiko-types/fields";
import type { IconKey } from "@cosmicdrift/kumiko-types/nav-icon";
import { NAV_ICON_KEYS } from "@cosmicdrift/kumiko-types/nav-icon";
import { rowMetaFieldNames } from "../../db/table-builder.js";
import { REFERENCE_LOOKUP_SOURCES } from "../../ui-types/list-row-meta.js";
import { isEncryptedAtRest } from "../config-helpers.js";
import { parseRefTarget } from "../parse-ref-target.js";
import { isKebabSegment, isValidQn, qualifyEntityName } from "../qualified-name.js";
import { getAllowedFilterOps, isFieldFilterable } from "../screen-filter-ops.js";
import {
  type FieldsOrGroupsSection,
  isExtensionEditSection,
  isFieldsEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  normalizeListColumn,
  resolveNavParentScreen,
  sectionFieldSpecs,
} from "../screen-helpers.js";
import type {
  ConfigKeyDefinition,
  EntityDefinition,
  FeatureDefinition,
  FieldDefinition,
  NavDefinition,
} from "../types/index.js";
import { metricField } from "../types/index.js";
import type {
  ActionFormRedirect,
  ActionFormScreenDefinition,
  DashboardChartMarkerKind,
  DashboardChartPanel,
  DashboardChartRanges,
  DashboardChartTone,
  DashboardCustomPanel,
  DashboardFilterDefinition,
  DashboardPanelDefinition,
  DashboardPanelVisibility,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardTimeRangeDefinition,
  DashboardValueFormat,
  EditFieldSpec,
  EditLayout,
  EditRelatedListSection,
  FieldCondition,
  ListColumnSpec,
  ListFacetSpec,
  RelatedListToolbarAction,
  RowAction,
  RowActionNavigateBase,
  RowFieldExtractor,
  ScreenDefinition,
  SecretMintScreenDefinition,
  ToolbarAction,
} from "../types/screen.js";
import { LIST_ROW_META_COLUMN_NAMES } from "./entity-list-screens.js";
import { isSelectOptionTone } from "./select-option-tone.js";

// entityList and projectionList both allow a rowAction to double as the
// row-body click target (rowClick: true, fw#1708/#2164) — at most one per
// screen, or the renderer can't tell which one should fire.
function validateAtMostOneRowClick(
  featureName: string,
  screenId: string,
  screenType: "entityList" | "projectionList",
  rowActions: readonly RowAction[],
): void {
  const rowClickActions = rowActions.filter((a) => a.kind === "navigate" && a.rowClick === true);
  if (rowClickActions.length > 1) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has ${rowClickActions.length} ` +
        "rowActions marked rowClick:true — at most one may fire on a row-body click.",
    );
  }
}

// A field type in NO_WIDGET_FIELD_TYPES renders read-only on the auto-wired
// entityEdit path (#1925) — a required field the user can never fill would
// block every save. Only the statically-resolvable case is caught here: a
// literal `required: true` (screen-spec override or entity-level default).
// A dynamic FieldCondition depends on runtime form values and can't be
// evaluated at boot; buildFormSchema() silently skips presence-checking it.
function validateNoWidgetRequiredField(
  featureName: string,
  screenId: string,
  entityDef: EntityDefinition,
  fieldSpec: Exclude<EditFieldSpec, string>,
): void {
  const fieldDef = entityDef.fields[fieldSpec.field];
  // skip: field doesn't exist or its type already has a widget — nothing to validate.
  if (fieldDef === undefined || !NO_WIDGET_FIELD_TYPES.includes(fieldDef.type)) return;
  // Embedded LIST fields (`multiple: true`) get their own EmbeddedListField
  // grid widget (#1838) — only plain (non-list) embedded has no widget.
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
  throw new Error(
    `[Feature ${featureName}] Screen "${screenId}" (entityEdit) field "${fieldSpec.field}" is ` +
      `type "${fieldDef.type}", which renders read-only on the auto-wired entityEdit path — a ` +
      `required field the user could never fill would block every save. Set required: false, ` +
      `move the field to a custom-component section, or drop the required constraint.`,
  );
}

export function rowFieldExtractorKeys(params: RowFieldExtractor): readonly string[] {
  return "pick" in params ? params.pick : Object.keys(params.map);
}

// Mirrors the renderer's navigate: an explicit entityId, or a same-entity
// entityEdit target (row["id"] auto-fill), opens UPDATE mode, which ignores params.
export function readsNavigateParamsAsFormPrefill(
  target: ScreenDefinition,
  explicitEntityId: string | undefined,
  sourceScreenEntity: string | undefined,
): boolean {
  if (target.type === "actionForm" || target.type === "secretMint") return true;
  if (target.type !== "entityEdit") return false;
  if (explicitEntityId !== undefined) return false;
  return sourceScreenEntity === undefined || target.entity !== sourceScreenEntity;
}

type NavigateSourceScreenType =
  | "entityList"
  | "projectionList"
  | "projectionDetail"
  | "entityEdit"
  | "entityList expandableRow";

// Tier 2.7e navigate rowAction → target-screen params validity. Shared by
// entityList and projectionList (framework#1708) — projectionList has no
// `screen.entity`, so there's no same-entity row["id"] auto-fill case: any
// entityEdit target without an explicit entityId reaches create there.
//
// dashboard targets (framework#1708 follow-up, commit 4e0d6cb26) also read
// URL search params — but only for the single `filter.id` a dashboard
// declares (useFilterParams in dashboard-body.tsx seeds its value from
// `nav.searchParams[filter.id]`). A dashboard with no `filter` has nowhere
// for the value to land, and a params extractor whose keys don't include
// the filter's id would silently miss it — both are boot errors instead of
// a silently-empty dashboard.
function validateRowActionNavigateParams(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  screenEntity: string | undefined,
  action: RowAction,
  target: { readonly featureName: string; readonly screen: ScreenDefinition } | undefined,
): void {
  // skip: not a navigate-with-params action — nothing to validate here.
  if (action.kind !== "navigate" || action.params === undefined) return;
  // skip: unresolvable/custom target already reported (or exempt) elsewhere.
  if (target === undefined || target.screen.type === "custom") return;
  // skip: entityList/projectionList targets also read URL search params (Tier
  // 2.7c filter-prefill, see use-list-url-state.ts: `<screenId>.q/.sort/
  // .dir/.page/.f.<field>`), not just actionForm/entityEdit-create.
  if (target.screen.type === "entityList" || target.screen.type === "projectionList") return;

  if (target.screen.type === "dashboard") {
    const targetDescriptor =
      action.screen !== undefined ? `"${action.screen}"` : `entity "${action.entity}"`;
    const filter = target.screen.filter;
    if (filter === undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) rowAction "${action.id}" sets ` +
          `params on navigate-target ${targetDescriptor} (dashboard) — target dashboard declares no ` +
          `filter — params would be a no-op. Remove the params extractor, or add a \`filter\` to the ` +
          `target dashboard so it has somewhere to read the value from.`,
      );
    }
    const extractedKeys = rowFieldExtractorKeys(action.params);
    if (!extractedKeys.includes(filter.id)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) rowAction "${action.id}" sets ` +
          `params [${extractedKeys.join(", ")}] on navigate-target ${targetDescriptor} (dashboard) whose ` +
          `filter id is "${filter.id}" — none of the extracted keys match, so the filter would stay ` +
          `unset. Fix the params extractor to produce a "${filter.id}" key, or remove it.`,
      );
    }
    // skip: filter present and the extractor's keys cover it — valid dashboard deep-link.
    return;
  }

  if (!readsNavigateParamsAsFormPrefill(target.screen, action.entityId, screenEntity)) {
    const isEntityEditUpdate = target.screen.type === "entityEdit";
    const reason = isEntityEditUpdate
      ? `resolves to UPDATE mode (${
          action.entityId !== undefined
            ? `explicit entityId "${action.entityId}"`
            : `same entity "${screenEntity}" auto-fills row["id"]`
        })`
      : `screen type "${target.screen.type}"`;
    const targetDescriptor =
      action.screen !== undefined ? `"${action.screen}"` : `entity "${action.entity}"`;
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) rowAction "${action.id}" ` +
        `sets params on navigate-target ${targetDescriptor} which ${reason} — only actionForm, ` +
        `secretMint and entityEdit-create targets read URL search params as initial values. Remove ` +
        `the params extractor or retarget to an actionForm / secretMint / cross-entity ` +
        `entityEdit-create screen.`,
    );
  }
}

// Shared by projectionDetail and entityEdit: a tab strip needs something to
// label each tab with and a stable id per tab — the id anchors the ?tab=
// param on projectionDetail and the jump-to-erroring-tab logic on entityEdit
// (fw#3134).
function validateTabSections(
  featureName: string,
  screenId: string,
  screenType: "projectionDetail" | "entityEdit",
  sections: readonly { readonly id?: string; readonly title?: string }[],
): void {
  if (sections.length < 2) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "tabs" but only ` +
        `${sections.length} section(s) — tabs need at least 2 sections.`,
    );
  }
  const tabIds = new Set<string>();
  sections.forEach((section, index) => {
    if (section.title === undefined || section.title.trim().length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "tabs" but ` +
          `sections[${index}] has no title — every tab needs a title.`,
      );
    }
    if (section.id === undefined || section.id.trim().length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "tabs" but ` +
          `sections[${index}] ("${section.title}") has no id — every tab needs a stable id.`,
      );
    }
    if (!isKebabSegment(section.id)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sections[${index}] ` +
          `("${section.title}") has id "${section.id}" — must be kebab-case.`,
      );
    }
    if (tabIds.has(section.id)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has duplicate tab id ` +
          `"${section.id}" (sections[${index}]).`,
      );
    }
    tabIds.add(section.id);
  });
}

// Wizard layouts (mode: "wizard") need >= 2 titled sections — a single or
// untitled step would leave the progress indicator blank, so both fail at
// boot rather than as a broken step UI.
function validateWizardLayout(
  featureName: string,
  screenId: string,
  screenType: "entityEdit" | "actionForm" | "configEdit" | "secretMint",
  layout: EditLayout,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // entityEdit renders tabs like wizard steps: every section stays mounted,
  // submit validates across all of them, and a field error jumps to the tab
  // holding it (fw#3134). The other three have no such jump — actionForm and
  // secretMint are one-shot forms, configEdit fires a write per field — so a
  // required field on a hidden tab would still block their submit silently.
  if (layout.mode === "tabs") {
    if (screenType !== "entityEdit") {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sets mode: "tabs" — tabs are only ` +
          `supported on projectionDetail and entityEdit. Use mode: "wizard" or "single" instead.`,
      );
    }
    validateTabSections(featureName, screenId, screenType, layout.sections);
  }
  // "form-draft" is hardcoded because the framework layer must not depend on
  // @cosmicdrift/kumiko-bundled-features — same precedence as the
  // "user-data-rights" check in gdpr-storage.ts.
  if (layout.draft === true) {
    if (layout.mode !== "wizard") {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sets draft: true but ` +
          `mode is not "wizard" — draft persistence only applies to wizard layouts. Remove ` +
          `draft: true or set mode: "wizard".`,
      );
    }
    if (!featureMap.has("form-draft")) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) sets draft: true but the ` +
          `bundled feature "form-draft" is not mounted — every resume would silently lose its ` +
          `values. Add formDraftFeature() from @cosmicdrift/kumiko-bundled-features to the app's ` +
          `feature list.`,
      );
    }
  }
  // skip: mode omitted/"single" — no wizard constraints apply.
  if (layout.mode !== "wizard") return;
  if (layout.sections.length < 2) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "wizard" but only ` +
        `${layout.sections.length} section(s) — a wizard needs at least 2 sections (one per step).`,
    );
  }
  layout.sections.forEach((section, index) => {
    if (section.title === undefined || section.title.trim().length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) has mode: "wizard" but ` +
          `sections[${index}] has no title — every wizard step needs a title.`,
      );
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
// them ships in M4/M5. Until then those are kept opaque on purpose.

// every action rendered in a Card title row (screen-level
// `actions`, section-level `actions`, `emptyState.action`) must draw an
// icon — declared or id-derived (resolveActionIcon, same resolver the
// renderer uses). Uncovered here: entityList/projectionList rowActions —
// those render inside a DataTable row, not a Card title row, so they keep
// today's "icon optional" behavior.
//
// Registration check (not just "resolved is not undefined"): action.icon is
// typed IconKey, a closed union — but that only protects call sites this
// repo's own `tsc --build` actually covers (samples and external consumers
// aren't in that project graph). The renderer's actionIconFor
// (renderer-web/src/primitives/index.tsx) already falls back to "no icon"
// for an unregistered key instead of crashing — this check makes the same
// gap fail loudly at boot instead of silently at render.
function isRegisteredIcon(icon: IconKey): boolean {
  return (NAV_ICON_KEYS as readonly string[]).includes(icon);
}

export function validateActionHasIcon(
  featureName: string,
  screenId: string,
  screenType: "projectionDetail" | "entityEdit",
  context: string,
  action: { readonly id: string; readonly icon?: IconKey },
): void {
  const resolved = resolveActionIcon(action.id, action.icon);
  if (resolved === undefined || !isRegisteredIcon(resolved)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${context} "${action.id}" has no ` +
        `resolvable icon — set icon to a key registered in NAV_ICONS, or use an id that resolves one of ` +
        `its kebab segments via the default icon map (resolveActionIcon).`,
    );
  }
}

// Tier 2.7e-3: deklarative Feld-Referenzen einer Action gegen die Entity-
// Felder pinnen — ein Tippfehler in pick/map-Quellfeldern oder
// visible.field erzeugte sonst still `undefined` im Payload bzw. dauerhaft
// falsche Sichtbarkeit (gleiche "Typo fällt erst beim Klick"-Klasse wie
// navigate/handler). Exported for query-output-columns.ts, which reuses it
// against a projectionDetail's outputSchema-derived record shape instead of
// an entity's field map (relatedList toolbarActions' visible/params).
export function validateActionFieldRefs(
  featureName: string,
  screenId: string,
  actionKind: "rowAction" | "toolbarAction",
  actionId: string,
  action: RowAction | ToolbarAction | RelatedListToolbarAction,
  fieldNames: ReadonlySet<string>,
  rowMeta: ReadonlySet<string>,
): void {
  // ToolbarAction.payload ist ein STATISCHER Record (kein Row-Context) —
  // nur echte pick/map-Extractoren werden gegen die Feldnamen geprüft.
  const isExtractor = (v: unknown): v is RowFieldExtractor =>
    typeof v === "object" && v !== null && ("pick" in v || "map" in v);
  const payload = "payload" in action && isExtractor(action.payload) ? action.payload : undefined;
  const params = "params" in action && isExtractor(action.params) ? action.params : undefined;
  const visible: FieldCondition | undefined = "visible" in action ? action.visible : undefined;
  const entityId: string | undefined = "entityId" in action ? action.entityId : undefined;
  const known = () => [...fieldNames].sort().join(", ") || "(none)";
  const checkExtractor = (label: string, extractor: RowFieldExtractor | undefined): void => {
    // skip: extractor ist ein optionaler Action-Slot — ohne ihn gibt es
    // keine Feld-Referenzen zu validieren.
    if (extractor === undefined) {
      return;
    }
    const sources = "pick" in extractor ? extractor.pick : Object.values(extractor.map);
    for (const source of sources) {
      if (rowMeta.has(source)) continue;
      if (!fieldNames.has(source)) {
        throw new Error(
          `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
            `${label} references unknown field "${source}". Known fields: ${known()}.`,
        );
      }
    }
  };
  checkExtractor("payload", payload);
  checkExtractor("params", params);
  if (
    visible !== undefined &&
    typeof visible !== "boolean" &&
    !rowMeta.has(visible.field) &&
    !fieldNames.has(visible.field)
  ) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
        `visible.field references unknown field "${visible.field}". Known fields: ${known()}.`,
    );
  }
  if (entityId !== undefined && entityId !== "id" && !fieldNames.has(entityId)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
        `entityId references unknown field "${entityId}". Known fields: ${known()}.`,
    );
  }
}

// Two features registering the same short screen-id is a silent routing
// footgun: create-app.tsx's runtime router resolves a bare navigate-target
// id by scanning features[] and taking the first match — the collision
// never surfaces as an error, the second feature's screen is just
// unreachable by that id (and always the same one that loses, in whatever
// order the app composed its features).
export function validateScreenShortIdCollisions(
  screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >,
): void {
  for (const [shortId, entries] of screensByShortId) {
    const featureNames = new Set(entries.map((e) => e.featureName));
    if (featureNames.size > 1) {
      throw new Error(
        `Screen short-id "${shortId}" is registered by ${featureNames.size} features ` +
          `(${[...featureNames].join(", ")}) — the runtime router resolves a bare navigate-target ` +
          `id by taking the first match, so all but one of these screens would be unreachable by ` +
          `that id. Give each screen a distinct id.`,
      );
    }
  }
}

// redirect/cancelTarget accept either a same-feature short id (unchanged
// behavior, qualified against the owning feature) or a fully-qualified
// cross-feature screen QN (`<feature>:screen:<id>`) given verbatim — a
// short id can never itself be a valid QN (QN_SEGMENT forbids colons), so
// the two forms don't collide.
export function resolveScreenTargetQn(featureName: string, target: string): string {
  return isValidQn(target) ? target : qualifyEntityName(featureName, "screen", target);
}

function validateScreenNavTarget(
  featureName: string,
  screenId: string,
  screenKind: string,
  fieldName: string,
  value: string,
  allScreenQns: ReadonlySet<string>,
  screens: FeatureDefinition["screens"],
): void {
  const candidateQn = resolveScreenTargetQn(featureName, value);
  if (!allScreenQns.has(candidateQn)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${fieldName} "${value}" ` +
        `does not resolve to a registered screen (checked "${candidateQn}"). Known screens ` +
        `in this feature: ${[...Object.keys(screens)].sort().join(", ") || "(none)"}.`,
    );
  }
}

// kind:"drawer" resolves same-feature only — unlike navigate/redirect,
// which the runtime router resolves app-wide (see the comment on
// validateScreens below), the drawer mounts the target inline using this
// feature's schema, so a cross-feature reference could never actually
// render. Two distinct failure messages: dangling reference vs. wrong
// screen type. Shared by ToolbarAction (fw#2225) and RowAction (fw#2710)
// drawer variants — same target-resolution rule, only the label in the
// error message ("toolbarAction" vs. "rowAction" vs. "action") differs.
function validateDrawerTargetAction(
  featureName: string,
  screenId: string,
  screenKind: string,
  actionLabel: "toolbarAction" | "rowAction" | "action",
  action: {
    readonly id: string;
    readonly screen: string;
    readonly params?: RowFieldExtractor;
  },
  screens: FeatureDefinition["screens"],
): void {
  const target = screens[action.screen];
  if (target === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${actionLabel} "${action.id}" ` +
        `drawer-target "${action.screen}" does not resolve to a registered screen in this feature. ` +
        `kind:"drawer" only resolves same-feature screens (unlike kind:"navigate", which can target ` +
        `screens in any feature) — the drawer mounts the target inline using this feature's schema. ` +
        `Known screens in this feature: ${[...Object.keys(screens)].sort().join(", ") || "(none)"}.`,
    );
  }
  // secretMint is intentionally excluded — a one-time secret reveal belongs on
  // its own page, not layered in a Drawer above a list.
  if (target.type !== "actionForm") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${actionLabel} "${action.id}" ` +
        `drawer-target "${action.screen}" is a "${target.type}" screen, not an actionForm. ` +
        `kind:"drawer" mounts an actionForm inside a Drawer widget — point "screen" at an ` +
        `actionForm screen, or use kind:"navigate" for a full-page target.`,
    );
  }
  // The renderer (mergeSearchParamsIntoInitial) silently drops a prefill key
  // when the target doesn't declare the field, marks it sensitive/password,
  // or doesn't render it in its layout — each would only show up as an empty
  // field at click time.
  // skip: no params extractor — nothing to check against the target's fields.
  if (action.params === undefined) return;
  validateDrawerPrefillKeys(
    `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) ${actionLabel} "${action.id}"`,
    action.screen,
    target,
    action.params,
  );
}

function validateDrawerPrefillKeys(
  where: string,
  targetScreenId: string,
  target: ActionFormScreenDefinition,
  params: RowFieldExtractor,
): void {
  const renderedFieldNames = new Set<string>();
  for (const section of target.layout.sections) {
    if (!isFieldsEditSection(section)) continue;
    for (const spec of sectionFieldSpecs(section))
      renderedFieldNames.add(normalizeEditField(spec).field);
  }
  for (const fieldName of rowFieldExtractorKeys(params)) {
    if (!Object.hasOwn(target.fields, fieldName)) {
      throw new Error(
        `${where} params prefills "${fieldName}", which drawer-target "${targetScreenId}" does not declare as a ` +
          `field — the renderer would drop it and leave the form empty. Target fields: ` +
          `${Object.keys(target.fields).sort().join(", ") || "(none)"}.`,
      );
    }
    const targetField = target.fields[fieldName];
    const isSensitiveOrPassword =
      targetField !== undefined &&
      (("sensitive" in targetField && targetField.sensitive === true) ||
        ("format" in targetField && targetField.format === "password"));
    if (isSensitiveOrPassword) {
      throw new Error(
        `${where} params prefills "${fieldName}", which drawer-target "${targetScreenId}" marks as ` +
          `sensitive or password — the renderer never prefills those fields and would leave the form empty.`,
      );
    }
    if (!renderedFieldNames.has(fieldName)) {
      throw new Error(
        `${where} params prefills "${fieldName}", which drawer-target "${targetScreenId}" does not render in ` +
          `its layout — the renderer only prefills fields the layout shows and would drop it.`,
      );
    }
  }
}

// fw#2228: a navigate rowAction (or projectionDetail header action, which
// reuses the same RowActionNavigate shape) names its target as either a
// screen (existing) or an entity (new) — exactly one. Shared by all three
// call sites so the mutual-exclusivity check and the entity→detailFor
// resolution don't drift between them (same drift risk
// validateRowActionNavigateParams above is already shared to avoid).
// Runtime-loose shape: boot still rejects both/neither for untyped schemas;
// authors get the exclusive union via RowActionNavigate (#2303).
type RowActionNavigateRuntime = RowActionNavigateBase & {
  readonly screen?: string;
  readonly entity?: string;
};

// The target can be any screen, so this checks the resolved target's
// sections, not the host's.
function validateRowActionNavigateTab(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  actionLabel: string,
  action: RowActionNavigateRuntime,
  target: { readonly featureName: string; readonly screen: ScreenDefinition } | undefined,
): void {
  // skip: no tab declared — nothing to check against the target's sections
  if (action.tab === undefined) return;
  if (target === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `sets tab "${action.tab}", but its navigate-target could not be resolved to a screen.`,
    );
  }
  if (target.screen.type !== "projectionDetail" || target.screen.layout.mode !== "tabs") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `sets tab "${action.tab}", but navigate-target screen "${target.screen.id}" is not a ` +
        `projectionDetail with layout.mode "tabs" — only those read the tab param.`,
    );
  }
  const sectionIds = target.screen.layout.sections
    .map((section) => section.id)
    .filter((id): id is string => id !== undefined);
  if (!sectionIds.includes(action.tab)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `navigates to tab "${action.tab}", which is not a section id on target screen ` +
        `"${target.screen.id}". Available: ${sectionIds.join(", ") || "(none)"}.`,
    );
  }
}

function resolveRowActionNavigateTarget(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  actionLabel: string,
  action: RowActionNavigateRuntime,
  allScreenQns: ReadonlySet<string>,
  navTargetShortIds: ReadonlySet<string>,
  screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >,
  detailForScreens: ReadonlyMap<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >,
): { readonly featureName: string; readonly screen: ScreenDefinition } | undefined {
  if (action.entity !== undefined) {
    if (action.screen !== undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
          `sets both "screen" and "entity" — exactly one navigate-target form is allowed.`,
      );
    }
    if (screenType !== "entityList" && action.entityId === undefined) {
      // entityList rows are always a real entity record, so row["id"] is a
      // safe implicit default. projectionList/projectionDetail rows come from
      // an arbitrary query projection with no guaranteed "id" field — an
      // entity-target there needs an explicit entityId, or navigation silently
      // opens the detail screen with no entity context at runtime.
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
          `navigate-target entity "${action.entity}" needs an explicit "entityId" — ${screenType} rows ` +
          `come from a query projection with no guaranteed "id" field.`,
      );
    }
    const detail = detailForScreens.get(action.entity);
    if (detail === undefined) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
          `navigate-target entity "${action.entity}" has no screen declaring ` +
          `detailFor: "${action.entity}".`,
      );
    }
    validateRowActionNavigateTab(featureName, screenId, screenType, actionLabel, action, detail);
    return detail;
  }
  if (action.screen === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `sets neither "screen" nor "entity" — exactly one navigate-target form is required.`,
    );
  }
  const candidateQn = qualifyEntityName(featureName, "screen", action.screen);
  if (!allScreenQns.has(candidateQn) && !navTargetShortIds.has(action.screen)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenType}) ${actionLabel} "${action.id}" ` +
        `navigate-target "${action.screen}" does not resolve to a registered screen in any feature.`,
    );
  }
  const target = screensByShortId.get(action.screen)?.[0];
  validateRowActionNavigateTab(featureName, screenId, screenType, actionLabel, action, target);
  return target;
}

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
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${context}) has empty or non-string handler.`,
    );
  }
  if (!allWriteHandlerQns.has(handler)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${context}) handler "${handler}" ` +
        `is not a registered write-handler. Check the QN spelling (expected ` +
        `"<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
    );
  }
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
// input-less mint, fw#2838): the secret is server-generated and the mint
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
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${context}) has empty fields map — ` +
        `declare at least one field.`,
    );
  }
  for (const [fname, fdef] of Object.entries(fields)) {
    // @cast-boundary schema-walk — feature-config inspection (Author may circumvent type-check)
    const ftype = (fdef as { type?: unknown }).type;
    if (typeof ftype !== "string" || ftype.length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${context}) field "${fname}" has no ` +
          `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
      );
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
      throw new Error(`${where} optionsQueryPayload references itself ({ field: "${ref}" })`);
    }
    if (!siblingFieldNames.has(ref)) {
      throw new Error(
        `${where} optionsQueryPayload references unknown field "${ref}" — it must be another field of the same form`,
      );
    }
  }
}

function isWriteOnlyField(fdef: FieldDefinition | undefined): boolean {
  return (fdef as { writeOnly?: unknown } | undefined)?.writeOnly === true; // @cast-boundary schema-walk
}

// Inline forms have no stored value to hide or keep: writeOnly there would
// render a "set / keep" affordance with nothing behind it.
function rejectWriteOnlyFormField(
  featureName: string,
  screenId: string,
  context: string,
  fieldName: string,
  fdef: FieldDefinition,
): void {
  if (isWriteOnlyField(fdef)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${context}) field "${fieldName}" declares writeOnly — ` +
        `writeOnly only applies to entity fields (nothing to hide on a form that stores no value). ` +
        `Use format: "password" for a masked input.`,
    );
  }
}

// Static options XOR optionsQuery on inline-form select fields, and `{ field }`
// payload refs must name another field of the same form (the payload also feeds
// optionsAvailabilityQuery). The QN existence check
// lives in query-refs.ts with the other query refs.
function validateFormSelectOptions(
  featureName: string,
  screenId: string,
  context: string,
  fieldName: string,
  fdef: FieldDefinition,
  siblingFieldNames: ReadonlySet<string>,
): void {
  if (fdef.type === "select") {
    const where = `[Feature ${featureName}] Screen "${screenId}" (${context}) select field "${fieldName}"`;
    if (fdef.optionsQuery !== undefined) {
      if (fdef.optionsQuery.length === 0) {
        throw new Error(`${where} has an empty optionsQuery`);
      }
      if (fdef.options.length > 0) {
        throw new Error(`${where} declares both options and optionsQuery — pick one`);
      }
      validateOptionsQueryFieldRefs(where, fieldName, fdef.optionsQueryPayload, siblingFieldNames);
    } else if (fdef.optionsAvailabilityQuery !== undefined) {
      if (fdef.optionsAvailabilityQuery.length === 0) {
        throw new Error(`${where} has an empty optionsAvailabilityQuery`);
      }
      validateOptionsQueryFieldRefs(where, fieldName, fdef.optionsQueryPayload, siblingFieldNames);
    } else if (fdef.optionsQueryPayload !== undefined) {
      throw new Error(`${where} has optionsQueryPayload without optionsQuery`);
    }
  }
}

// Fail-closed currency-source gate (fw#2839), the runtime half of the
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
    throw new Error(
      `${where} must declare where its currency comes from — this screen has no entity whose ` +
        `\`defaultCurrency\` it could inherit, so the form would seed a bare \`0\` that the ` +
        `handler's schema rejects. ${validForms}`,
    );
  }
  if (typeof currency !== "object" || currency === null) {
    throw new Error(`${where} has a non-object \`currency\`. ${validForms}`);
  }
  const kind = currency.kind;
  if (kind === "literal") {
    const code = currency.code;
    if (typeof code !== "string" || code.trim() === "") {
      throw new Error(
        `${where} declares \`currency: { kind: "literal" }\` with an empty or non-string \`code\`. ` +
          `Pass the ISO code, e.g. { kind: "literal", code: "EUR" }.`,
      );
    }
  } else if (kind !== "tenant") {
    throw new Error(
      `${where} declares an unknown currency kind ${JSON.stringify(kind)}. ${validForms}`,
    );
  }
}

// `allowEmptySections` mirrors `validateFormFieldsMap`'s `allowEmpty` — the
// caller only ever passes true together with an actually-empty fields map
// (an input-less secretMint declares BOTH `fields: {}` and
// `layout.sections: []`; fields declared with no layout to show them stays
// an error).
// `fields`/`groups` are mutually exclusive on a fields-kind section; shared by
// every EditLayout-walking screen type instead of four hand-rolled copies.
function validateFieldsXorGroups(
  errorPrefix: string,
  section: FieldsOrGroupsSection & { readonly title?: string },
): void {
  if (section.fields.length > 0 && section.groups !== undefined) {
    throw new Error(
      `${errorPrefix} section "${section.title}" declares both fields and groups — pass fields: [] ` +
        `when using groups.`,
    );
  }
  if (section.fields.length === 0 && (section.groups?.length ?? 0) === 0) {
    throw new Error(
      `${errorPrefix} has a section "${section.title}" with zero fields — drop the section or add ` +
        `fields (or groups) to it.`,
    );
  }
}

function validateFormLayoutSections(
  featureName: string,
  screenId: string,
  context: string,
  layout: EditLayout,
  fieldNames: ReadonlySet<string>,
  allowEmptySections: boolean,
): void {
  if (layout.sections.length === 0) {
    // skip: an input-less secretMint declares fields: {} and sections: [] together — no sections to validate.
    if (allowEmptySections) return;
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${context}) has an empty sections list — ` +
        `declare at least one section.`,
    );
  }
  for (const section of layout.sections) {
    if (isExtensionEditSection(section)) {
      if (section.component?.react === undefined && section.component?.native === undefined) {
        throw new Error(
          `[Feature ${featureName}] Screen "${screenId}" (${context}) extension section ` +
            `"${section.title}" has no component — declare a react/native component marker.`,
        );
      }
      continue;
    }
    if (section.kind === "relatedList") {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${context}) relatedList section ` +
          `"${section.title}" is not supported — relatedList is a projectionDetail-only ` +
          `primitive (fw#2166).`,
      );
    }
    if (isWriteFormEditSection(section)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (${context}) writeForm section ` +
          `"${section.title}" is not supported — writeForm is a projectionDetail-only primitive.`,
      );
    }
    validateFieldsXorGroups(`[Feature ${featureName}] Screen "${screenId}" (${context})`, section);
    for (const fieldSpec of sectionFieldSpecs(section)) {
      const normalized = normalizeEditField(fieldSpec);
      if (!fieldNames.has(normalized.field)) {
        throw new Error(
          `[Feature ${featureName}] Screen "${screenId}" (${context}) layout references unknown field ` +
            `"${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
        );
      }
    }
  }
}

// redirect is either a short screen id (same-feature, e.g. "item-list") or
// a fully-qualified cross-feature QN (`<feature>:screen:<id>`) — the
// renderer strips the latter to the short id (lastSegment) when
// navigating, which the nav-router resolves app-wide (#1946). The object
// form (fw#2670) carries the same target under `screen` plus the payload
// field `idFrom`. Shared by actionForm/secretMint (validateInlineFormNavTargets)
// and entityEdit — same rule, same error message, one place to keep them in sync.
function validateRedirectTarget(
  feature: FeatureDefinition,
  screenId: string,
  screenKind: "actionForm" | "secretMint" | "entityEdit" | "projectionDetail",
  redirect: string | ActionFormRedirect,
  allScreenQns: ReadonlySet<string>,
): void {
  const redirectTarget = typeof redirect === "string" ? redirect : redirect.screen;
  if (
    typeof redirect !== "string" &&
    (typeof redirect.idFrom !== "string" || redirect.idFrom.trim() === "")
  ) {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${screenKind}) redirect.idFrom is empty or not a string — ` +
        `name the success-payload field carrying the navigation id, or use the plain string ` +
        `redirect form to navigate with the handler's own "id".`,
    );
  }
  // The renderer reads idFrom verbatim (Object.hasOwn), so stray whitespace
  // never matches and the navigation silently lands without an entityId.
  if (typeof redirect !== "string" && redirect.idFrom !== redirect.idFrom.trim()) {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${screenKind}) redirect.idFrom "${redirect.idFrom}" ` +
        `has leading/trailing whitespace — it would never match a payload field.`,
    );
  }
  validateScreenNavTarget(
    feature.name,
    screenId,
    screenKind,
    "redirect",
    redirectTarget,
    allScreenQns,
    feature.screens,
  );
}

// redirect is only honored on record actions; on list/related-list row
// actions it would be silently dropped, so the author would believe it works.
function rejectRedirectOnListRowAction(
  featureName: string,
  screenId: string,
  screenKind: string,
  action: RowAction,
): void {
  if (action.kind !== "navigate" && action.kind !== "drawer" && action.redirect !== undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) rowAction "${action.id}" sets redirect — ` +
        `redirect is only honored on record actions (projectionDetail/entityEdit header and section ` +
        `actions) and is ignored on list row actions. Remove it.`,
    );
  }
}

// A writeHandler record action's redirect (projectionDetail/entityEdit
// header and section actions) follows the entityEdit.redirect rule.
function validateRecordActionRedirect(
  feature: FeatureDefinition,
  screenId: string,
  screenKind: "projectionDetail" | "entityEdit",
  action: RowAction,
  allScreenQns: ReadonlySet<string>,
): void {
  if (action.kind !== "navigate" && action.kind !== "drawer" && action.redirect !== undefined) {
    validateRedirectTarget(feature, screenId, screenKind, action.redirect, allScreenQns);
  }
}

function validateScreenVisibleWhen(
  feature: FeatureDefinition,
  screenId: string,
  screen: ScreenDefinition,
  allScreenQns: ReadonlySet<string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const { visibleWhen, fallback } = screen;
  const context = `[Feature ${feature.name}] Screen "${screenId}" (${screen.type})`;
  if (visibleWhen === undefined && fallback !== undefined) {
    throw new Error(`${context} declares fallback without visibleWhen.`);
  }
  if (visibleWhen !== undefined && (visibleWhen.query === "" || visibleWhen.field === "")) {
    throw new Error(`${context} visibleWhen needs a non-empty query and field.`);
  }
  if (fallback !== undefined) {
    validateScreenFallback(feature, screenId, screen.type, fallback, allScreenQns, featureMap);
  }
}

function validateScreenFallback(
  feature: FeatureDefinition,
  screenId: string,
  screenType: ScreenDefinition["type"],
  fallback: string,
  allScreenQns: ReadonlySet<string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const context = `[Feature ${feature.name}] Screen "${screenId}" (${screenType})`;
  validateScreenNavTarget(
    feature.name,
    screenId,
    screenType,
    "fallback",
    fallback,
    allScreenQns,
    feature.screens,
  );
  const fallbackQn = resolveScreenTargetQn(feature.name, fallback);
  if (fallbackQn === qualifyEntityName(feature.name, "screen", screenId)) {
    throw new Error(`${context} fallback points at the screen itself.`);
  }
  // A gated fallback could hide in turn and chain or cycle (A→B→A); one hop keeps the
  // runtime gate trivially terminating.
  const [fallbackFeatureName = "", , fallbackShortId = ""] = fallbackQn.split(":");
  if (featureMap.get(fallbackFeatureName)?.screens[fallbackShortId]?.visibleWhen !== undefined) {
    throw new Error(
      `${context} fallback "${fallback}" has its own visibleWhen; a fallback must always render.`,
    );
  }
}

function validateInlineFormNavTargets(
  feature: FeatureDefinition,
  screenId: string,
  screen: ActionFormScreenDefinition | SecretMintScreenDefinition,
  kind: "actionForm" | "secretMint",
  allScreenQns: ReadonlySet<string>,
): void {
  if (screen.redirect !== undefined) {
    validateRedirectTarget(feature, screenId, kind, screen.redirect, allScreenQns);
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
function validateInlineFormScreen(
  feature: FeatureDefinition,
  screenId: string,
  screen: ActionFormScreenDefinition | SecretMintScreenDefinition,
  kind: "actionForm" | "secretMint",
  allWriteHandlerQns: ReadonlySet<string>,
  allScreenQns: ReadonlySet<string>,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  validateWriteHandlerRegistered(feature.name, screenId, kind, screen.handler, allWriteHandlerQns);
  // Only a secretMint's own mint step may skip fields/sections entirely
  // (input-less mint, fw#2838) — actionForm always needs at least one field.
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
    allowEmptyMintForm && fieldNames.size === 0,
  );
  validateWizardLayout(feature.name, screenId, kind, screen.layout, featureMap);
  validateInlineFormNavTargets(feature, screenId, screen, kind, allScreenQns);
}

// SecretMintConfirmStep (fw#2838): an optional proof-of-receipt form rendered
// on the reveal card in place of the bare acknowledge button (TOTP enrollment:
// scan the code, then enter one). Unlike the mint step, confirm always needs
// at least one field — a step whose only job is proving receipt with no input
// would be meaningless — and its layout is a single plain form, never a
// wizard/tabs flow and never a persisted draft: a one-time reveal-confirm is
// not a multi-step flow, and persisting a draft of it would re-open the leak
// fw#2548 closed (a lingering copy of the just-revealed secret in storage).
function validateSecretMintConfirm(
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
  validateFormLayoutSections(feature.name, screenId, context, confirm.layout, fieldNames, false);
  if (confirm.layout.mode !== undefined && confirm.layout.mode !== "single") {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${context}) sets layout.mode: ` +
        `"${confirm.layout.mode}" — a one-time reveal confirm step must stay a single-step form. ` +
        `Remove mode or set it to "single".`,
    );
  }
  if (confirm.layout.draft === true) {
    throw new Error(
      `[Feature ${feature.name}] Screen "${screenId}" (${context}) sets layout.draft: true — ` +
        `persisting a draft of the reveal-confirm step would leak the one-time secret into storage, ` +
        `the exact leak fw#2548 closed. Remove draft: true.`,
    );
  }
  // skip: no carry list declared — no carried fields to cross-check against confirm.fields.
  if (confirm.carry === undefined) return;
  for (const carryField of confirm.carry) {
    if (typeof carryField !== "string" || carryField.trim() === "") {
      throw new Error(
        `[Feature ${feature.name}] Screen "${screenId}" (${context}) has an empty or non-string ` +
          `entry in "carry".`,
      );
    }
    if (fieldNames.has(carryField)) {
      throw new Error(
        `[Feature ${feature.name}] Screen "${screenId}" (${context}) carry field "${carryField}" ` +
          `also names a confirm.fields entry — a carried mint-payload value would silently ` +
          `overwrite the user-entered field of the same name. Rename one of them.`,
      );
    }
  }
}

type NavAreaIndex = {
  readonly anyNavRegistered: boolean;
  // nav.screen is a full QN (cross-feature): every screen QN a standalone
  // r.nav() entry or one of its actions points at.
  readonly navTargetQns: ReadonlySet<string>;
  readonly allScreens: readonly ScreenDefinition[];
};

// validateScreenHasNavArea runs once per screen; the index is built once per
// featureMap (immutable during boot) instead of re-scanning every feature each call.
const navAreaIndexByFeatureMap = new WeakMap<
  ReadonlyMap<string, FeatureDefinition>,
  NavAreaIndex
>();

function navTargetScreenQns(nav: NavDefinition): readonly string[] {
  return [nav.screen, nav.createAction?.screen, ...(nav.actions ?? []).map((a) => a.screen)].filter(
    (qn): qn is string => qn !== undefined,
  );
}

function getNavAreaIndex(featureMap: ReadonlyMap<string, FeatureDefinition>): NavAreaIndex {
  const cached = navAreaIndexByFeatureMap.get(featureMap);
  if (cached !== undefined) return cached;
  const navTargetQns = new Set<string>();
  const allScreens: ScreenDefinition[] = [];
  let anyNavRegistered = false;
  for (const f of featureMap.values()) {
    allScreens.push(...Object.values(f.screens));
    for (const nav of Object.values(f.navs)) {
      anyNavRegistered = true;
      for (const qn of navTargetScreenQns(nav)) navTargetQns.add(qn);
    }
  }
  const index: NavAreaIndex = { anyNavRegistered, navTargetQns, allScreens };
  navAreaIndexByFeatureMap.set(featureMap, index);
  return index;
}

// Every screen must resolve nav via `nav`, `r.nav()`, a parent list, or
// `dormant: true`. Skipped when the composed set has no nav entries at all.
function validateScreenHasNavArea(
  feature: FeatureDefinition,
  screenId: string,
  screen: ScreenDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // skip: the screen already declares its own nav entry.
  if (screen.nav !== undefined) return;
  // skip: explicitly opted out via `dormant: true`.
  if (screen.dormant === true) return;
  const { anyNavRegistered, navTargetQns, allScreens } = getNavAreaIndex(featureMap);
  // skip: no nav entries exist anywhere in the composed set — a feature/
  // recipe/test fixture booted without an app shell, not an omission.
  if (!anyNavRegistered) return;
  const targetQn = qualifyEntityName(feature.name, "screen", screenId);
  // skip: a standalone r.nav() elsewhere already points at this screen.
  if (navTargetQns.has(targetQn)) return;
  // skip: resolves to a parent list via listScreenId/rowAction-target/same-entity.
  if (resolveNavParentScreen(allScreens, screen, (s) => s.id) !== undefined) return;
  throw new Error(
    `[Feature ${feature.name}] Screen "${targetQn}" has no nav entry and no resolvable list — ` +
      `declare listScreenId (or a rowAction/toolbarAction navigate target from a list screen), add ` +
      `a standalone r.nav() pointing at it, or set dormant: true if it's intentionally reachable ` +
      `only via a direct link/redirect or a consuming app's own r.nav().`,
  );
}

type RelatedListSectionValidation = {
  readonly featureName: string;
  readonly featureMap: ReadonlyMap<string, FeatureDefinition>;
  readonly screenId: string;
  readonly screenType: NavigateSourceScreenType;
  readonly where: string;
  readonly section: EditRelatedListSection;
  readonly screens: FeatureDefinition["screens"];
  readonly allWriteHandlerQns: ReadonlySet<string>;
  readonly allScreenQns: ReadonlySet<string>;
  readonly navTargetShortIds: ReadonlySet<string>;
  readonly screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >;
  readonly detailForScreens: ReadonlyMap<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >;
};

// Shared by projectionDetail relatedList sections and entityList.expandableRow:
// both render a relatedList whose rows come from an arbitrary query.
function validateRelatedListSection(args: RelatedListSectionValidation): void {
  const { featureName, featureMap, where, section } = args;
  if (!section.query || typeof section.query !== "string") {
    throw new Error(`[Feature ${featureName}] ${where} has empty or non-string query.`);
  }
  if (section.entity !== undefined) {
    assertRefTargetRegistered(
      `[Feature ${featureName}] ${where}`,
      "entity",
      section.entity,
      featureName,
      featureMap,
    );
  }
  for (const col of section.columns) {
    const normalizedCol = normalizeListColumn(col);
    if (normalizedCol.refEntity !== undefined) {
      assertRefTargetRegistered(
        `[Feature ${featureName}] ${where}`,
        `column "${normalizedCol.field}" (refEntity)`,
        normalizedCol.refEntity,
        featureName,
        featureMap,
      );
    }
  }
  if (section.rowClick !== undefined) {
    const targetEntity = section.rowClick.entity;
    const hasDetailScreen = [...featureMap.values()].some((f) =>
      Object.values(f.screens).some((s) => s.detailFor === targetEntity),
    );
    if (!hasDetailScreen) {
      throw new Error(
        `[Feature ${featureName}] ${where} ` +
          `rowClick targets entity "${targetEntity}", but no screen declares ` +
          `detailFor: "${targetEntity}". Add detailFor: "${targetEntity}" to the screen that shows it.`,
      );
    }
  }
  if (section.rowActions !== undefined) validateRelatedListRowActions(args, section.rowActions);
  if (section.defaultSort !== undefined) validateRelatedListDefaultSort(args, section.defaultSort);
  if (section.facets !== undefined) {
    validateListFacets(
      `[Feature ${featureName}] ${where}`,
      section.facets,
      section.columns,
      featureName,
      featureMap,
    );
  }
  if (section.toolbarActions !== undefined) {
    validateRelatedListToolbarActions(args, section.toolbarActions);
  }
}

function validateRelatedListRowActions(
  args: RelatedListSectionValidation,
  rowActions: NonNullable<EditRelatedListSection["rowActions"]>,
): void {
  const {
    featureName,
    screenId,
    screenType,
    where,
    section,
    screens,
    allWriteHandlerQns,
    allScreenQns,
    navTargetShortIds,
    screensByShortId,
    detailForScreens,
  } = args;
  for (const action of rowActions) {
    rejectRedirectOnListRowAction(featureName, screenId, screenType, action);
    if (action.kind === "navigate") {
      const target = resolveRowActionNavigateTarget(
        featureName,
        screenId,
        screenType,
        "rowAction",
        action,
        allScreenQns,
        navTargetShortIds,
        screensByShortId,
        detailForScreens,
      );
      validateRowActionNavigateParams(featureName, screenId, screenType, undefined, action, target);
    } else if (action.kind === "drawer") {
      validateDrawerTargetAction(featureName, screenId, screenType, "rowAction", action, screens);
    } else if (!allWriteHandlerQns.has(action.handler)) {
      throw new Error(
        `[Feature ${featureName}] ${where} ` +
          `rowAction "${action.id}" handler "${action.handler}" ` +
          `is not a registered write-handler. Check the QN spelling (expected ` +
          `"<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
      );
    }
  }
  // section.rowClick (legacy, navigate-only) and a rowActions entry
  // marked rowClick:true both claim the row-body click — same
  // at-most-one constraint as entityList/projectionList's
  // validateAtMostOneRowClick, just spanning two fields instead of one.
  const rowClickActionCount = rowActions.filter(
    (a) => a.kind === "navigate" && a.rowClick === true,
  ).length;
  const legacyRowClickCount = section.rowClick !== undefined ? 1 : 0;
  if (rowClickActionCount + legacyRowClickCount > 1) {
    throw new Error(
      `[Feature ${featureName}] ${where} ` +
        `has both a rowClick and ${rowClickActionCount} rowActions marked ` +
        `rowClick:true — at most one may fire on a row-body click.`,
    );
  }
}

function validateRelatedListDefaultSort(
  args: RelatedListSectionValidation,
  defaultSort: NonNullable<EditRelatedListSection["defaultSort"]>,
): void {
  const { featureName, where, section } = args;
  const sortField = defaultSort.field;
  const col = section.columns.find((c) => normalizeListColumn(c).field === sortField);
  if (col === undefined) {
    throw new Error(
      `[Feature ${featureName}] ${where} ` +
        `defaultSort.field "${sortField}" is not a listed column.`,
    );
  }
  if (normalizeListColumn(col).sortable !== true) {
    throw new Error(
      `[Feature ${featureName}] ${where} ` +
        `defaultSort.field "${sortField}" is not sortable. Set sortable: true on ` +
        `the column or pick another field.`,
    );
  }
}

// Only drawer-kind and navigate actions that set tab are validated here;
// plain navigate (no tab) and writeHandler toolbarActions have no boot check yet.
function validateRelatedListToolbarActions(
  args: RelatedListSectionValidation,
  toolbarActions: NonNullable<EditRelatedListSection["toolbarActions"]>,
): void {
  const {
    featureName,
    screenId,
    screenType,
    screens,
    allScreenQns,
    navTargetShortIds,
    screensByShortId,
    detailForScreens,
  } = args;
  for (const action of toolbarActions) {
    if (action.kind === "drawer") {
      validateDrawerTargetAction(
        featureName,
        screenId,
        screenType,
        "toolbarAction",
        action,
        screens,
      );
    }
    if (action.kind === "navigate" && action.tab !== undefined) {
      resolveRowActionNavigateTarget(
        featureName,
        screenId,
        screenType,
        "toolbarAction",
        action,
        allScreenQns,
        navTargetShortIds,
        screensByShortId,
        detailForScreens,
      );
    }
  }
}

type NavigateTargetLookups = {
  readonly allScreenQns: ReadonlySet<string>;
  readonly navTargetShortIds: ReadonlySet<string>;
  readonly screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >;
  readonly detailForScreens: ReadonlyMap<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >;
};

// Only a navigate action that sets `tab` needs the target resolved (to check
// the tab id); plain navigates are validated elsewhere. One place for every
// section-level action site so a new site can't forget the tab check.
function validateNavigateActionTab(
  featureName: string,
  screenId: string,
  screenType: NavigateSourceScreenType,
  actionLabel: string,
  action: RowAction,
  lookups: NavigateTargetLookups,
): void {
  // skip: only navigate actions with an explicit tab need target validation
  if (action.kind !== "navigate" || action.tab === undefined) return;
  resolveRowActionNavigateTarget(
    featureName,
    screenId,
    screenType,
    actionLabel,
    action,
    lookups.allScreenQns,
    lookups.navTargetShortIds,
    lookups.screensByShortId,
    lookups.detailForScreens,
  );
}

export function validateScreens(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  allWriteHandlerQns: ReadonlySet<string>,
  allScreenQns: ReadonlySet<string>,
  configKeyDefsByQn: ReadonlyMap<string, ConfigKeyDefinition>,
  screensByShortId: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >,
  detailForScreens: ReadonlyMap<
    string,
    { readonly featureName: string; readonly screen: ScreenDefinition }
  >,
): void {
  // navigate-Targets (rowAction/toolbarAction) dürfen cross-feature zeigen —
  // der Runtime-Router (create-app) löst eine bare screenId app-weit über ALLE
  // Features auf (eine deklarative Liste im owning-Feature der Entity navigiert
  // so zu den Custom-Editoren der Consumer-App). Der Validator spiegelt das:
  // same-feature ODER irgendein Feature. redirect/cancelTarget akzeptieren
  // zusätzlich eine voll-qualifizierte Cross-Feature-QN (resolveScreenTargetQn,
  // #1946) — kurze IDs bleiben same-feature wie zuvor.
  const navTargetShortIds = screenShortIdsFrom(allScreenQns);
  const navigateLookups: NavigateTargetLookups = {
    allScreenQns,
    navTargetShortIds,
    screensByShortId,
    detailForScreens,
  };
  for (const [screenId, screen] of Object.entries(feature.screens)) {
    validateScreenHasNavArea(feature, screenId, screen, featureMap);
    validateScreenVisibleWhen(feature, screenId, screen, allScreenQns, featureMap);
    if (screen.type === "custom") {
      if (!screen.renderer.react && !screen.renderer.native) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" has type="custom" but the renderer ` +
            `declares neither a react nor a native component — at least one platform must be set.`,
        );
      }
      continue;
    }

    if (screen.type === "projectionList") {
      // Query-getrieben, keine Entity → nur query + columns prüfen (die
      // Column-Felder können nicht gegen eine Entity gecheckt werden; sie
      // werden zur Render-Zeit gegen die Projection-Rows aufgelöst).
      if (!screen.query || typeof screen.query !== "string") {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionList) has empty or non-string query.`,
        );
      }
      if (screen.columns.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionList) has an empty columns list — ` +
            `declare at least one column.`,
        );
      }
      for (const col of screen.columns) {
        const normalizedCol = normalizeListColumn(col);
        validateColumnRendererForm(feature.name, screenId, normalizedCol);
        if (normalizedCol.refEntity !== undefined) {
          assertRefTargetRegistered(
            `[Feature ${feature.name}] Screen "${screenId}" (projectionList)`,
            `column "${normalizedCol.field}" (refEntity)`,
            normalizedCol.refEntity,
            feature.name,
            featureMap,
          );
        }
      }
      // Screen filter (fw#2224) — field existence can't be checked without
      // an entity (columns aren't a complete field inventory of the
      // underlying query), so only pin the structure: "in" requires an
      // array. Field validity is documented in the PR body.
      if (
        screen.filter !== undefined &&
        screen.filter.op === "in" &&
        !Array.isArray(screen.filter.value)
      ) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionList) filter.op "in" requires ` +
            `filter.value to be a readonly array.`,
        );
      }
      if (screen.facets !== undefined) {
        validateListFacets(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionList)`,
          screen.facets,
          screen.columns,
          feature.name,
          featureMap,
        );
      }
      if (screen.rowActions !== undefined) {
        for (const action of screen.rowActions) {
          rejectRedirectOnListRowAction(feature.name, screenId, "projectionList", action);
          if (action.kind === "navigate") {
            const target = resolveRowActionNavigateTarget(
              feature.name,
              screenId,
              "projectionList",
              "rowAction",
              action,
              allScreenQns,
              navTargetShortIds,
              screensByShortId,
              detailForScreens,
            );
            validateRowActionNavigateParams(
              feature.name,
              screenId,
              "projectionList",
              undefined,
              action,
              target,
            );
          } else if (action.kind === "drawer") {
            validateDrawerTargetAction(
              feature.name,
              screenId,
              "projectionList",
              "rowAction",
              action,
              feature.screens,
            );
          }
        }
        validateAtMostOneRowClick(feature.name, screenId, "projectionList", screen.rowActions);
      }
      // Only drawer-kind and navigate actions that set tab are validated
      // here — plain navigate (no tab) and writeHandler toolbarActions on
      // projectionList have no boot check yet (pre-existing gap).
      if (screen.toolbarActions !== undefined) {
        for (const action of screen.toolbarActions) {
          if (action.kind === "drawer") {
            validateDrawerTargetAction(
              feature.name,
              screenId,
              "projectionList",
              "toolbarAction",
              action,
              feature.screens,
            );
          }
          if (action.kind === "navigate" && action.tab !== undefined) {
            resolveRowActionNavigateTarget(
              feature.name,
              screenId,
              "projectionList",
              "toolbarAction",
              action,
              allScreenQns,
              navTargetShortIds,
              screensByShortId,
              detailForScreens,
            );
          }
        }
      }
      continue;
    }

    if (screen.type === "projectionDetail") {
      // Query-getrieben wie projectionList, aber Single-Row + Layout statt
      // Columns. Kein Entity-Check möglich — Felder werden render-seitig
      // gegen die Query-Response aufgelöst, nicht gegen eine Entity.
      if (!screen.query || typeof screen.query !== "string") {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) has empty or non-string query.`,
        );
      }
      if (screen.singleton === true && screen.idParam !== undefined) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) sets both singleton: true ` +
            `and idParam — singleton means the server picks the row from the caller's context, so there ` +
            `is no row id to send under idParam. Remove idParam.`,
        );
      }
      // singleton has no row id in the path, but the auto-generated "Edit"
      // action (fw#2166, defaultEditAction in kumiko-screen.tsx) navigates
      // to the detailFor entity's entityEdit screen using that path id —
      // under singleton it would silently open that screen in CREATE mode
      // instead of editing the singleton row. Reject rather than let that
      // win silently, same as the idParam check above.
      if (screen.singleton === true && screen.detailFor !== undefined) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) sets both singleton: true ` +
            `and detailFor — the auto-generated "Edit" action navigates using the path's row id, which a ` +
            `singleton screen never has. Remove detailFor, or declare an explicit "edit" action instead.`,
        );
      }
      if (screen.recordTitleField !== undefined && screen.header !== undefined) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) sets both header and ` +
            `recordTitleField — header.title already names the record, so drop recordTitleField.`,
        );
      }
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      if (screen.layout.mode === "tabs") {
        validateTabSections(feature.name, screenId, "projectionDetail", screen.layout.sections);
        for (const section of screen.layout.sections) {
          const isFieldsSection = section.kind === undefined || section.kind === "fields";
          if (isFieldsSection && section.groups !== undefined && section.actions !== undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.id}" ` +
                `declares both groups and actions in tabs mode — actions has no single group's Card to sit ` +
                `in, and an extra title-less Card around the group cards would nest a Card inside a Card. ` +
                `Move the actions onto one group's title, or drop groups for a flat fields grid.`,
            );
          }
        }
      }
      if (screen.metrics !== undefined) {
        for (const metric of screen.metrics) {
          const field = metricField(metric);
          const hasOwnLabel = typeof metric !== "string" && metric.label !== undefined;
          if (!hasOwnLabel && screen.fieldLabels?.[field] === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) metric "${field}" has ` +
                `no entry in fieldLabels and no own "label" — every metrics field needs one of the two, ` +
                `there is no fallback to the raw column name.`,
            );
          }
          const navigate = typeof metric === "string" ? undefined : metric.navigate;
          if (navigate !== undefined) {
            if (navigate.screen === undefined && navigate.entity === undefined) {
              if (
                navigate.tab !== undefined &&
                !screen.layout.sections.some((section) => section.id === navigate.tab)
              ) {
                throw new Error(
                  `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) metric "${field}" ` +
                    `navigates to tab "${navigate.tab}", which is not a section id on this screen.`,
                );
              }
            } else {
              // Also runs without `tab`: a typo'd screen/entity or an entity
              // target without entityId would otherwise render a clickable
              // metric that silently does nothing.
              resolveRowActionNavigateTarget(
                feature.name,
                screenId,
                "projectionDetail",
                "metric",
                {
                  kind: "navigate",
                  id: field,
                  label: field,
                  ...(navigate.screen !== undefined ? { screen: navigate.screen } : {}),
                  ...(navigate.entity !== undefined ? { entity: navigate.entity } : {}),
                  ...(navigate.entityId !== undefined ? { entityId: navigate.entityId } : {}),
                  ...(navigate.tab !== undefined ? { tab: navigate.tab } : {}),
                },
                allScreenQns,
                navTargetShortIds,
                screensByShortId,
                detailForScreens,
              );
            }
          }
        }
      }
      for (const [statusValue, tone] of Object.entries(screen.header?.statusTones ?? {})) {
        if (!isSelectOptionTone(tone)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) header.statusTones["${statusValue}"] ` +
              `is "${String(tone)}" — expected one of ${SELECT_OPTION_TONES.join(", ")}.`,
          );
        }
      }
      if (Array.isArray(screen.header?.subtitle)) {
        if (screen.header.subtitleHref !== undefined) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) sets header.subtitleHref ` +
              `together with a multi-part header.subtitle — subtitleHref only works with the string form.`,
          );
        }
        const seenPartFields = new Set<string>();
        for (const part of screen.header.subtitle) {
          const partField = typeof part === "string" ? part : part.field;
          if (seenPartFields.has(partField)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) header.subtitle ` +
                `lists field "${partField}" twice.`,
            );
          }
          seenPartFields.add(partField);
          const navigate = typeof part === "string" ? undefined : part.navigate;
          if (navigate === undefined) continue;
          if (navigate.screen === undefined && navigate.entity === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) header.subtitle part ` +
                `"${partField}" navigates with neither "screen" nor "entity" — a tab-only navigate has no link target.`,
            );
          }
          resolveRowActionNavigateTarget(
            feature.name,
            screenId,
            "projectionDetail",
            "subtitle part",
            {
              kind: "navigate",
              id: partField,
              label: partField,
              ...(navigate.screen !== undefined ? { screen: navigate.screen } : {}),
              ...(navigate.entity !== undefined ? { entity: navigate.entity } : {}),
              ...(navigate.entityId !== undefined ? { entityId: navigate.entityId } : {}),
              ...(navigate.tab !== undefined ? { tab: navigate.tab } : {}),
            },
            allScreenQns,
            navTargetShortIds,
            screensByShortId,
            detailForScreens,
          );
        }
      }
      for (const section of screen.layout.sections) {
        const sectionLabel = section.title ?? section.id ?? "(untitled)";
        if (section.actions !== undefined) {
          for (const action of section.actions) {
            validateActionHasIcon(
              feature.name,
              screenId,
              "projectionDetail",
              `section "${sectionLabel}" action`,
              action,
            );
            validateRecordActionRedirect(
              feature,
              screenId,
              "projectionDetail",
              action,
              allScreenQns,
            );
            validateNavigateActionTab(
              feature.name,
              screenId,
              "projectionDetail",
              `section "${sectionLabel}" action`,
              action,
              navigateLookups,
            );
          }
        }
        if (section.kind === "relatedList" && section.emptyState?.action !== undefined) {
          validateActionHasIcon(
            feature.name,
            screenId,
            "projectionDetail",
            `section "${sectionLabel}" emptyState action`,
            section.emptyState.action,
          );
          validateNavigateActionTab(
            feature.name,
            screenId,
            "projectionDetail",
            `section "${sectionLabel}" emptyState action`,
            section.emptyState.action,
            navigateLookups,
          );
        }
        if (isExtensionEditSection(section)) {
          // projectionDetail is read-only (no composed form submit) — an
          // extension that persists through the host's Save button has
          // nothing to save against. Extensions that persist themselves
          // (e.g. notes-history NotesSection, via their own dispatcher
          // writes) are fine (solon#264).
          if (section.contributesToFormSubmit === true) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) extension section ` +
                `"${section.title}" sets contributesToFormSubmit: true, but projectionDetail has no ` +
                `form submit to contribute to (read-only screen). Omit contributesToFormSubmit and ` +
                `persist through the extension's own dispatcher writes instead.`,
            );
          }
          if (section.component?.react === undefined && section.component?.native === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) extension section ` +
                `"${section.title}" has no component — declare a react/native component marker.`,
            );
          }
          // The host-derived entity name on projectionDetail is an internal
          // placeholder (no real entity backs this screen) — a self-
          // persisting extension needs the real domain entity name declared
          // explicitly, or it silently reads/writes against the wrong type.
          if (section.entityName === undefined || section.entityName.trim().length === 0) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) extension section ` +
                `"${section.title}" has no entityName — projectionDetail has no real entity, so the ` +
                `extension must declare entityName explicitly (the domain entity it persists against).`,
            );
          }
          continue;
        }
        if (section.kind === "relatedList") {
          if (screen.layout.mode === "wizard") {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                `is kind "relatedList" in a wizard layout — a read-only list is not supported in a ` +
                `stepped form. Remove mode: "wizard" or drop the relatedList section.`,
            );
          }
          validateRelatedListSection({
            featureName: feature.name,
            featureMap,
            screenId,
            screenType: "projectionDetail",
            where: `Screen "${screenId}" (projectionDetail) section "${section.title}" (relatedList)`,
            section,
            screens: feature.screens,
            allWriteHandlerQns,
            allScreenQns,
            navTargetShortIds,
            screensByShortId,
            detailForScreens,
          });
          continue;
        }
        if (isWriteFormEditSection(section)) {
          if (Object.keys(section.fieldDefs).length === 0) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                `(writeForm) has an empty fieldDefs map — declare at least one field type.`,
            );
          }
          if (section.fields.length === 0) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                `(writeForm) has zero fields — drop the section or add fields to it.`,
            );
          }
          // A ref to a fieldDef the form never renders would never resolve.
          const writeFormFieldNames = new Set(
            // kumiko-lint-ignore section-fields-raw writeForm sections carry no groups (EditWriteFormSection)
            section.fields.map((f) => normalizeEditField(f).field),
          );
          for (const [defName, fdef] of Object.entries(section.fieldDefs)) {
            validateFormSelectOptions(
              feature.name,
              screenId,
              `projectionDetail section "${section.title}" writeForm`,
              defName,
              fdef,
              writeFormFieldNames,
            );
            rejectWriteOnlyFormField(
              feature.name,
              screenId,
              `projectionDetail section "${section.title}" writeForm`,
              defName,
              fdef,
            );
          }
          // kumiko-lint-ignore section-fields-raw writeForm sections carry no groups (EditWriteFormSection)
          for (const f of section.fields) {
            const fieldName = normalizeEditField(f).field;
            if (section.fieldDefs[fieldName] === undefined) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                  `(writeForm) field "${fieldName}" has no entry in fieldDefs — every rendered field needs ` +
                  `a type declared there.`,
              );
            }
          }
          if (screen.layout.mode === "wizard") {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                `is kind "writeForm" in a wizard layout — a self-persisting form is not supported in a ` +
                `stepped form. Remove mode: "wizard" or drop the writeForm section.`,
            );
          }
          if (!allWriteHandlerQns.has(section.handler)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                `(writeForm) handler "${section.handler}" is not a registered write-handler. Check the QN ` +
                `spelling (expected "<feature>:write:<short>") and that the handler is declared via ` +
                `r.writeHandler(...).`,
            );
          }
          continue;
        }
        validateFieldsXorGroups(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail)`,
          section,
        );
        for (const fieldSpec of sectionFieldSpecs(section)) {
          const normalizedField = normalizeEditField(fieldSpec);
          if (normalizedField.refEntity !== undefined) {
            assertRefTargetRegistered(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail)`,
              `field "${normalizedField.field}" (refEntity)`,
              normalizedField.refEntity,
              feature.name,
              featureMap,
            );
          }
        }
      }
      // Header actions reuse RowAction (the displayed record stands in for
      // the row), so the same navigate/writeHandler existence checks as
      // entityList/projectionList apply. `rowClick` is rejected outright —
      // a detail screen has no row to click.
      if (screen.actions !== undefined) {
        for (const action of screen.actions) {
          validateActionHasIcon(feature.name, screenId, "projectionDetail", "action", action);
          validateRecordActionRedirect(feature, screenId, "projectionDetail", action, allScreenQns);
          if (action.kind === "navigate" && action.rowClick === true) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${qualifyEntityName(feature.name, "screen", screenId)}" ` +
                `(projectionDetail) action "${action.id}" sets rowClick: true — there is no row to ` +
                `click on a detail screen. Remove rowClick.`,
            );
          }
          if (action.kind === "navigate") {
            const target = resolveRowActionNavigateTarget(
              feature.name,
              screenId,
              "projectionDetail",
              "action",
              action,
              allScreenQns,
              navTargetShortIds,
              screensByShortId,
              detailForScreens,
            );
            validateRowActionNavigateParams(
              feature.name,
              screenId,
              "projectionDetail",
              screen.detailFor,
              action,
              target,
            );
          } else if (action.kind === "drawer") {
            validateDrawerTargetAction(
              feature.name,
              screenId,
              "projectionDetail",
              "action",
              action,
              feature.screens,
            );
          } else {
            if (!allWriteHandlerQns.has(action.handler)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) action "${action.id}" ` +
                  `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                  `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
              );
            }
          }
        }
      }
      continue;
    }

    if (screen.type === "dashboard") {
      validateDashboardScreen(feature.name, screenId, screen, featureMap);
      continue;
    }

    if (screen.type === "configEdit") {
      // configEdit: layout/fields wie actionForm validieren, plus
      // Cross-Check dass jeder qualifizierte Config-Key registriert
      // ist und der scope mit dem Key matcht.
      const fieldNames = new Set(Object.keys(screen.fields));
      if (fieldNames.size === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has empty fields map — ` +
            `declare at least one field.`,
        );
      }
      for (const [fname, fdef] of Object.entries(screen.fields)) {
        // @cast-boundary schema-walk — feature-config inspection
        const ftype = (fdef as { type?: unknown }).type;
        if (typeof ftype !== "string" || ftype.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" has no ` +
              `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
          );
        }
        validateFormSelectOptions(feature.name, screenId, "configEdit", fname, fdef, fieldNames);
      }
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (isExtensionEditSection(section)) {
          if (section.component?.react === undefined && section.component?.native === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (configEdit) extension section ` +
                `"${section.title}" has no component — declare a react/native component marker.`,
            );
          }
          continue;
        }
        if (section.kind === "relatedList") {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) relatedList section ` +
              `"${section.title}" is not supported — relatedList is a projectionDetail-only ` +
              `primitive (fw#2166).`,
          );
        }
        if (isWriteFormEditSection(section)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) writeForm section ` +
              `"${section.title}" is not supported — writeForm is a projectionDetail-only primitive.`,
          );
        }
        validateFieldsXorGroups(
          `[Feature ${feature.name}] Screen "${screenId}" (configEdit)`,
          section,
        );
        for (const fieldSpec of sectionFieldSpecs(section)) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (configEdit) layout references unknown ` +
                `field "${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
            );
          }
        }
      }
      validateWizardLayout(feature.name, screenId, "configEdit", screen.layout, featureMap);
      // configKeys: jeder fieldName muss einen Mapping-Eintrag haben,
      // jeder qualifizierte Key muss in der Registry existieren.
      for (const fname of fieldNames) {
        const qualified = screen.configKeys[fname];
        if (qualified === undefined) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" hat ` +
              `keinen Eintrag in configKeys-Map. Jedes deklarierte Field braucht ein Mapping zu ` +
              `einem qualifizierten Config-Key (\`<feature>:config:<short>\`).`,
          );
        }
        const configKeyDef = configKeyDefsByQn.get(qualified);
        if (configKeyDef === undefined) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" → ` +
              `Config-Key "${qualified}" ist in keiner Feature-Registry deklariert. Tippfehler? ` +
              `Erwartetes Format: "<feature>:config:<short>". Bekannte Keys: ${
                [...configKeyDefsByQn.keys()].sort().join(", ") || "(keine)"
              }`,
          );
        }
        if (isWriteOnlyField(screen.fields[fname]) && !isEncryptedAtRest(configKeyDef)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" declares writeOnly ` +
              `but config key "${qualified}" is not encrypted at rest — writeOnly on a configEdit field ` +
              `only hides a stored secret (declare the key with encrypted: true or backing: "secrets").`,
          );
        }
      }
      continue;
    }

    if (screen.type === "actionForm") {
      validateInlineFormScreen(
        feature,
        screenId,
        screen,
        "actionForm",
        allWriteHandlerQns,
        allScreenQns,
        featureMap,
      );
      continue;
    }

    if (screen.type === "secretMint") {
      validateInlineFormScreen(
        feature,
        screenId,
        screen,
        "secretMint",
        allWriteHandlerQns,
        allScreenQns,
        featureMap,
      );
      if (screen.reveal.fields.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (secretMint) has an empty reveal.fields ` +
            `list — declare at least one field to reveal.`,
        );
      }
      const revealFieldNames = new Set<string>();
      for (const revealField of screen.reveal.fields) {
        if (typeof revealField.field !== "string" || revealField.field.trim() === "") {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (secretMint) has a reveal.fields entry ` +
              `with an empty or non-string "field".`,
          );
        }
        if (revealFieldNames.has(revealField.field)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (secretMint) reveal.fields has a ` +
              `duplicate field "${revealField.field}" — each revealed field must be unique.`,
          );
        }
        revealFieldNames.add(revealField.field);
        if (typeof revealField.label !== "string" || revealField.label.trim() === "") {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (secretMint) reveal.fields entry ` +
              `"${revealField.field}" has an empty or non-string "label".`,
          );
        }
      }
      validateSecretMintConfirm(feature, screenId, screen, allWriteHandlerQns);
      continue;
    }

    // secretsEdit is generator-only (buildConfigFeatureSchema) — never
    // authored via r.screen, so feature.screens never actually carries one.
    // Kept here only so this loop's type narrowing stays exhaustive.
    if (screen.type === "secretsEdit") continue;

    // entityList / entityEdit: entity-refs are feature-local.
    const entityDef = feature.entities?.[screen.entity];
    if (!entityDef) {
      const known =
        Object.keys(feature.entities ?? {})
          .sort()
          .join(", ") || "(none)";
      const crossFeature = findEntityFeature(screen.entity, featureMap);
      const hint = crossFeature
        ? ` Entity "${screen.entity}" is owned by feature "${crossFeature}" — cross-feature screen ownership is not supported.`
        : "";
      throw new Error(
        `[Feature ${feature.name}] Screen "${screenId}" references entity "${screen.entity}" ` +
          `which is not declared in this feature (known: ${known}).${hint}`,
      );
    }

    const fieldNames = new Set(Object.keys(entityDef.fields));
    // List columns may also name a read-time derived field (not a stored
    // column). Allowed for display; deliberately NOT added to `fieldNames`, so
    // defaultSort/filter on a derived field still fails — server-side sort over
    // a non-column is a silent no-op (see DerivedFieldDef).
    const columnFieldNames =
      entityDef.derivedFields !== undefined
        ? new Set([...fieldNames, ...Object.keys(entityDef.derivedFields)])
        : fieldNames;
    const rowMeta = rowMetaFieldNames(entityDef.softDelete ?? false);
    if (screen.type === "entityList") {
      // Empty column list would render as a blank table — almost always the
      // sign of an in-progress screen the author forgot to fill in. Fail
      // loud: ui-core's computeListViewModel can't do anything useful with
      // zero columns either.
      if (screen.columns.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityList) has an empty columns list — ` +
            `declare at least one column.`,
        );
      }
      for (const col of screen.columns) {
        const normalized = normalizeListColumn(col);
        // A row-meta column (id/tenantId/version/insertedAt/modifiedAt/...) is a
        // real DB column without being a declared entity field — e.g. a
        // SystemAdmin cross-tenant list exposing tenantId. Accept it like a
        // regular field name — but only the columns computeListViewModel can
        // actually render (LIST_ROW_META_COLUMN_NAMES), not the wider
        // softDelete-aware rowMeta set used below for payload/visible refs.
        //
        // A virtual presentational column (drawn by a columnRenderer component
        // from the row, e.g. tag chips) needs BOTH a label AND a renderer —
        // renderer is what actually makes it "virtual" (label alone still
        // needs list.ts's virtual-branch to have something to draw; without
        // a renderer the column would render nothing). A column with neither
        // matching a real field/row-meta column NOR a renderer is a typo worth
        // failing the boot.
        if (
          !columnFieldNames.has(normalized.field) &&
          !LIST_ROW_META_COLUMN_NAMES.has(normalized.field) &&
          !(normalized.label !== undefined && normalized.renderer !== undefined)
        ) {
          throw new Error(
            buildUnknownFieldMessage(
              feature.name,
              screenId,
              normalized.field,
              screen.entity,
              columnFieldNames,
            ),
          );
        }
        validateColumnRendererForm(feature.name, screenId, normalized);
        if (normalized.refEntity !== undefined) {
          assertRefTargetRegistered(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList)`,
            `column "${normalized.field}" (refEntity)`,
            normalized.refEntity,
            feature.name,
            featureMap,
          );
        }
      }
      // Pagination/Sort/Search-Validierung: Author-Fehler beim Boot
      // fangen, damit kein "warum kommt die Liste leer / falsch
      // sortiert"-Debug-Cycle zur Laufzeit losgeht.
      if (screen.pageSize !== undefined && screen.pageSize <= 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityList) has pageSize=${screen.pageSize} — ` +
            `must be a positive integer.`,
        );
      }
      if (screen.defaultSort !== undefined) {
        const sortField = screen.defaultSort.field;
        if (!fieldNames.has(sortField)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) defaultSort references unknown ` +
              `field "${sortField}". Known fields: ${[...fieldNames].sort().join(", ")}`,
          );
        }
        // sortable: true Pflicht — verhindert dass das UI auf einer
        // Spalte sortiert, die Server-Side gar keinen DB-Index hat
        // oder im Schema absichtlich nicht sortiert werden soll
        // (Audit-Felder, Computed-Werte). `sortable` lebt heute nur
        // auf TextFieldDef; "in"-narrow lässt das auch für andere
        // Field-Types ohne explizites Flag durchfallen, was ok ist:
        // Number/Date sind natürlich sortierbar, der Author kann sie
        // im Author-Code als sortable markieren wenn das Field-Type
        // es trägt (Erweiterung folgt).
        const fieldDef = entityDef.fields[sortField];
        const isSortable =
          fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true;
        if (!isSortable) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) defaultSort.field "${sortField}" ` +
              `is not sortable. Set sortable: true on the field definition or pick another field.`,
          );
        }
      }
      if (
        screen.createScreen !== undefined &&
        !Object.hasOwn(feature.screens, screen.createScreen)
      ) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityList) createScreen ` +
            `"${screen.createScreen}" does not resolve to a registered screen in this feature. ` +
            `Known screens in this feature: ${Object.keys(feature.screens).sort().join(", ") || "(none)"}.`,
        );
      }
      // Screen-Filter (Tier 2.7c) — drei Layer Author-Code-Check:
      //   1) Field existiert auf der Entity (Tippfehler = leere Liste
      //      statt Crash; Boot-Fail ist deutlich besser).
      //   2) Field hat `filterable: true` (Author opt-in, analog zu
      //      `sortable`). Verhindert dass Audit-/Computed-/encrypted-
      //      Felder unbeabsichtigt filterbar werden.
      //   3) Op passt zum Field-Type. Lt/gt auf text-Feldern → Boot-
      //      Fail mit Hinweis statt String-Sort-Surprise zur Laufzeit.
      // Außerdem: "in" verlangt readonly Array.
      if (screen.filter !== undefined) {
        const filterField = screen.filter.field;
        if (!fieldNames.has(filterField)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references unknown ` +
              `field "${filterField}". Known fields: ${[...fieldNames].sort().join(", ")}`,
          );
        }
        const fieldDef = entityDef.fields[filterField];
        if (fieldDef !== undefined && !isFieldFilterable(fieldDef)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references field ` +
              `"${filterField}" which is not filterable. Set filterable: true on the field ` +
              `definition or pick another field.`,
          );
        }
        if (fieldDef !== undefined) {
          const allowedOps = getAllowedFilterOps(fieldDef);
          if (!allowedOps.includes(screen.filter.op)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter.op ` +
                `"${screen.filter.op}" is not allowed on field "${filterField}" ` +
                `(type "${fieldDef.type}"). Allowed ops: ${allowedOps.join(", ") || "(none)"}.`,
            );
          }
        }
        if (screen.filter.op === "in" && !Array.isArray(screen.filter.value)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter.op "in" requires ` +
              `filter.value to be a readonly array.`,
          );
        }
      }
      // Tier 2.7e-1: rowActions pinnen — navigate-target existiert (selbes
      // Feature), writeHandler-QN ist registriert. Tippfehler fallen sonst
      // erst beim ersten Klick als "Screen not found" / 404 auf.
      if (screen.rowActions !== undefined) {
        for (const action of screen.rowActions) {
          rejectRedirectOnListRowAction(feature.name, screenId, "entityList", action);
          if (action.kind === "navigate") {
            const target = resolveRowActionNavigateTarget(
              feature.name,
              screenId,
              "entityList",
              "rowAction",
              action,
              allScreenQns,
              navTargetShortIds,
              screensByShortId,
              detailForScreens,
            );
            // The renderer's default-entityId fallback (row["id"]) only fires
            // for a same-feature entityEdit target — it can't safely guess
            // the id for a screen owned by a different feature. Cross-feature
            // + entityEdit therefore MUST set an explicit entityId, or the
            // edit screen silently opens with no entity context at runtime.
            // Entity-targets (fw#2228) are exempt: the renderer always
            // supplies an id for them (explicit entityId, else row["id"]),
            // regardless of which feature the resolved detailFor screen
            // belongs to.
            if (
              action.screen !== undefined &&
              target !== undefined &&
              target.featureName !== feature.name &&
              target.screen.type === "entityEdit" &&
              action.entityId === undefined
            ) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) rowAction "${action.id}" ` +
                  `navigates cross-feature to entityEdit screen "${action.screen}" (feature ` +
                  `"${target.featureName}") without an explicit entityId field — the renderer's ` +
                  `same-feature row["id"] fallback does not apply across features. Set entityId to ` +
                  `the row field that names the target entity's id.`,
              );
            }
            // params only have a reader in actionForm and entityEdit-CREATE;
            // on projectionDetail/dashboard/configEdit/entityEdit-update they
            // are silently ignored at runtime. `custom` is deliberately
            // exempt: it renders an app-registered component the framework
            // has no visibility into — the author may read nav.searchParams
            // directly (real example: publicstatus's MonitorDetailScreen
            // does exactly that), so flagging it would be a false positive
            // on working code, not a caught bug.
            //
            // Whether an entityEdit target lands in create or update mode is
            // decided by the same rule the renderer's runNavigate() uses: an
            // explicit entityId always forces update mode, and (absent an
            // explicit entityId) a same-entity target gets row["id"] auto-
            // injected — only a cross-entity target with no explicit
            // entityId reaches create.
            validateRowActionNavigateParams(
              feature.name,
              screenId,
              "entityList",
              screen.entity,
              action,
              target,
            );
          } else if (action.kind === "drawer") {
            validateDrawerTargetAction(
              feature.name,
              screenId,
              "entityList",
              "rowAction",
              action,
              feature.screens,
            );
          } else {
            if (!allWriteHandlerQns.has(action.handler)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) rowAction "${action.id}" ` +
                  `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                  `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
              );
            }
          }
          validateActionFieldRefs(
            feature.name,
            screenId,
            "rowAction",
            action.id,
            action,
            fieldNames,
            rowMeta,
          );
        }
        validateAtMostOneRowClick(feature.name, screenId, "entityList", screen.rowActions);
      }
      // Tier 2.7e-2: toolbarActions — analog zu rowActions, aber bisher
      // ohne Validator. Typo'd navigate-targets und unregistrierte
      // writeHandler-QNs fallen bis hierhin erst beim Klick auf.
      if (screen.toolbarActions !== undefined) {
        for (const action of screen.toolbarActions) {
          if (action.kind === "navigate") {
            const candidateQn = qualifyEntityName(feature.name, "screen", action.screen);
            if (!allScreenQns.has(candidateQn) && !navTargetShortIds.has(action.screen)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) toolbarAction "${action.id}" ` +
                  `navigate-target "${action.screen}" does not resolve to a registered screen in any feature.`,
              );
            }
            if (action.tab !== undefined) {
              resolveRowActionNavigateTarget(
                feature.name,
                screenId,
                "entityList",
                "toolbarAction",
                action,
                allScreenQns,
                navTargetShortIds,
                screensByShortId,
                detailForScreens,
              );
            }
          } else if (action.kind === "drawer") {
            validateDrawerTargetAction(
              feature.name,
              screenId,
              "entityList",
              "toolbarAction",
              action,
              feature.screens,
            );
          } else {
            if (!allWriteHandlerQns.has(action.handler)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) toolbarAction "${action.id}" ` +
                  `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                  `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
              );
            }
          }
          validateActionFieldRefs(
            feature.name,
            screenId,
            "toolbarAction",
            action.id,
            action,
            fieldNames,
            rowMeta,
          );
        }
      }
      if (screen.expandableRow !== undefined) {
        const expandableRow = screen.expandableRow;
        validateRelatedListSection({
          featureName: feature.name,
          featureMap,
          screenId,
          screenType: "entityList expandableRow",
          where: `Screen "${screenId}" (entityList) expandableRow "${expandableRow.title}"`,
          section: expandableRow,
          screens: feature.screens,
          allWriteHandlerQns,
          allScreenQns,
          navTargetShortIds,
          screensByShortId,
          detailForScreens,
        });
        // Toolbar actions of the expansion evaluate against the host row.
        for (const action of expandableRow.toolbarActions ?? []) {
          validateActionFieldRefs(
            feature.name,
            screenId,
            "toolbarAction",
            action.id,
            action,
            fieldNames,
            rowMeta,
          );
        }
      }
    } else {
      // Same rationale as the columns check: an entityEdit layout with zero
      // sections (or sections without any fields) renders as nothing — reject
      // at boot so the author sees it before the blank form surprises them.
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (section.actions !== undefined) {
          const sectionLabel = section.title ?? section.id ?? "(untitled)";
          for (const action of section.actions) {
            validateActionHasIcon(
              feature.name,
              screenId,
              "entityEdit",
              `section "${sectionLabel}" action`,
              action,
            );
            validateRecordActionRedirect(feature, screenId, "entityEdit", action, allScreenQns);
            validateNavigateActionTab(
              feature.name,
              screenId,
              "entityEdit",
              `section "${sectionLabel}" action`,
              action,
              navigateLookups,
            );
          }
        }
        if (isExtensionEditSection(section)) {
          if (section.component?.react === undefined && section.component?.native === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) extension section ` +
                `"${section.title}" has no component — declare a react/native component marker.`,
            );
          }
          continue;
        }
        if (section.kind === "relatedList") {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) relatedList section ` +
              `"${section.title}" is not supported — relatedList is a projectionDetail-only ` +
              `primitive (fw#2166).`,
          );
        }
        if (isWriteFormEditSection(section)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) writeForm section ` +
              `"${section.title}" is not supported — writeForm is a projectionDetail-only primitive.`,
          );
        }
        validateFieldsXorGroups(
          `[Feature ${feature.name}] Screen "${screenId}" (entityEdit)`,
          section,
        );
        for (const fieldSpec of sectionFieldSpecs(section)) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              buildUnknownFieldMessage(
                feature.name,
                screenId,
                normalized.field,
                screen.entity,
                fieldNames,
              ),
            );
          }
          validateNoWidgetRequiredField(feature.name, screenId, entityDef, normalized);
        }
      }
      validateWizardLayout(feature.name, screenId, "entityEdit", screen.layout, featureMap);
      // Header actions reuse RowAction — same shape and same checks as
      // projectionDetail's `actions` above (the loaded record stands in
      // for the row). `rowClick` is rejected outright — entityEdit has no
      // row to click either.
      if (screen.actions !== undefined) {
        for (const action of screen.actions) {
          validateRecordActionRedirect(feature, screenId, "entityEdit", action, allScreenQns);
          if (action.kind === "navigate" && action.rowClick === true) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${qualifyEntityName(feature.name, "screen", screenId)}" ` +
                `(entityEdit) action "${action.id}" sets rowClick: true — there is no row to click ` +
                `on an edit screen. Remove rowClick.`,
            );
          }
          if (action.kind === "navigate") {
            const target = resolveRowActionNavigateTarget(
              feature.name,
              screenId,
              "entityEdit",
              "action",
              action,
              allScreenQns,
              navTargetShortIds,
              screensByShortId,
              detailForScreens,
            );
            validateRowActionNavigateParams(
              feature.name,
              screenId,
              "entityEdit",
              screen.entity,
              action,
              target,
            );
          } else if (action.kind === "drawer") {
            validateDrawerTargetAction(
              feature.name,
              screenId,
              "entityEdit",
              "action",
              action,
              feature.screens,
            );
          } else {
            if (!allWriteHandlerQns.has(action.handler)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) action "${action.id}" ` +
                  `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                  `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
              );
            }
          }
        }
      }
      if (screen.recordTitleField !== undefined && !fieldNames.has(screen.recordTitleField)) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) recordTitleField ` +
            `"${screen.recordTitleField}" is not a field of entity "${screen.entity}" ` +
            `(known: ${[...fieldNames].sort().join(", ")}).`,
        );
      }
      if (screen.redirect !== undefined) {
        validateRedirectTarget(feature, screenId, "entityEdit", screen.redirect, allScreenQns);
      }
    }
  }
}

// Panel-getrieben, keine Entity — Struktur-Checks (eindeutige Panel-Ids,
// non-empty Queries/Columns/valueField); die Query-Contracts (Stat-Record,
// Points-Envelope, Paged-Rows) werden zur Render-Zeit aufgelöst.
function validateDashboardScreen(
  featureName: string,
  screenId: string,
  screen: DashboardScreenDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (screen.panels.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) has an empty panels list — ` +
        `declare at least one panel.`,
    );
  }
  const panelIds = new Set<string>();
  const addPanelId = (id: string, context: string): void => {
    if (panelIds.has(id)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) has duplicate panel id "${id}" (${context}).`,
      );
    }
    panelIds.add(id);
  };

  for (const panel of screen.panels) {
    addPanelId(panel.id, panel.kind);
    if (panel.kind === "stat-group") {
      validateDashboardStatGroupPanel(featureName, screenId, panel, addPanelId);
    } else if (panel.kind === "custom") {
      validateDashboardCustomPanel(featureName, screenId, panel);
    } else if (panel.kind === "screen") {
      validateDashboardScreenPanel(featureName, screenId, panel, featureMap);
    } else {
      validateDashboardQueryPanel(featureName, screenId, panel, featureMap);
    }
  }

  if (screen.filter !== undefined) {
    validateDashboardFilterDefinition(featureName, screenId, screen.filter);
  }
  if (screen.timeRange !== undefined) {
    validateDashboardTimeRange(featureName, screenId, screen.timeRange, screen.filter?.id);
  }
}

function validateDashboardTimeRange(
  featureName: string,
  screenId: string,
  timeRange: DashboardTimeRangeDefinition,
  filterId: string | undefined,
): void {
  const prefix = `[Feature ${featureName}] Screen "${screenId}" (dashboard) timeRange`;
  if (timeRange.id.length === 0) throw new Error(`${prefix} has an empty id.`);
  if (timeRange.id === filterId) {
    throw new Error(
      `${prefix} id "${timeRange.id}" collides with the filter id — both live in the URL search params.`,
    );
  }
  if (timeRange.options.length === 0) {
    throw new Error(`${prefix}.options is empty — declare at least one option.`);
  }
  const values = new Set<string>();
  for (const option of timeRange.options) {
    if (option.value.length === 0 || option.label.length === 0) {
      throw new Error(`${prefix} option needs a non-empty value and label.`);
    }
    if (values.has(option.value)) {
      throw new Error(`${prefix}.options has duplicate value "${option.value}".`);
    }
    values.add(option.value);
  }
  if (!values.has(timeRange.default)) {
    throw new Error(
      `${prefix}.default "${timeRange.default}" is not among the options (${[...values].join(", ")}).`,
    );
  }
}

const EMBEDDABLE_SCREEN_TYPES: ReadonlySet<ScreenDefinition["type"]> = new Set([
  "projectionList",
  "actionForm",
  "secretMint",
  "configEdit",
  "secretsEdit",
]);

export function validateDashboardScreenPanel(
  featureName: string,
  screenId: string,
  panel: DashboardScreenPanel,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const context = `[Feature ${featureName}] Screen "${screenId}" (dashboard) screen-panel "${panel.id}"`;
  const targetQn = resolveScreenTargetQn(featureName, panel.screen);
  const [targetFeatureName = "", , targetShortId = ""] = targetQn.split(":");
  const target = featureMap.get(targetFeatureName)?.screens[targetShortId];
  if (target === undefined) {
    throw new Error(
      `${context} screen "${panel.screen}" does not resolve to a registered screen (checked "${targetQn}"). ` +
        `Use a same-feature short id or a cross-feature QN "<feature>:screen:<id>".`,
    );
  }
  if (!EMBEDDABLE_SCREEN_TYPES.has(target.type)) {
    throw new Error(
      `${context} embeds "${targetQn}" of type "${target.type}", which can't be embedded — allowed: ` +
        `${[...EMBEDDABLE_SCREEN_TYPES].join(", ")}. Use a custom panel for app components.`,
    );
  }
  // ActionFormBody/SecretMintBody navigate via nav.navigate after submit or
  // cancel even when embedded, which would pull the user off the dashboard.
  if (
    (target.type === "actionForm" || target.type === "secretMint") &&
    (target.redirect !== undefined ||
      (target.cancelTarget !== undefined && target.cancelTarget !== false))
  ) {
    throw new Error(
      `${context} embeds "${targetQn}", which sets redirect/cancelTarget — an embedded form would ` +
        `navigate away from the dashboard on submit or cancel. Embed a screen without redirect and ` +
        `with cancelTarget: false (or omitted).`,
    );
  }
  validateDashboardPanelVisibleWhen(context, panel.visibleWhen);
}

function validateDashboardPanelVisibleWhen(
  context: string,
  visibleWhen: DashboardPanelVisibility | undefined,
): void {
  if (visibleWhen !== undefined && (visibleWhen.query === "" || visibleWhen.field === "")) {
    throw new Error(`${context} visibleWhen needs a non-empty query and field.`);
  }
}

function validateDashboardPanelSpan(
  featureName: string,
  screenId: string,
  panel: { readonly id: string; readonly span?: unknown },
): void {
  if (panel.span !== undefined && panel.span !== "half" && panel.span !== "full") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}" has span "${String(panel.span)}" — expected "half" or "full".`,
    );
  }
}

function validateDashboardStatGroupPanel(
  featureName: string,
  screenId: string,
  panel: DashboardStatGroupPanel,
  addPanelId: (id: string, context: string) => void,
): void {
  const context = `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}"`;
  if (panel.stats.length === 0) {
    throw new Error(`${context} has an empty stats list.`);
  }
  if (panel.subtitle !== undefined && panel.label === undefined) {
    throw new Error(
      `${context} sets subtitle without label — an unlabeled group renders as a KPI strip without a header.`,
    );
  }
  validateDashboardPanelSpan(featureName, screenId, panel);
  validateDashboardPanelVisibleWhen(context, panel.visibleWhen);
  for (const stat of panel.stats) {
    addPanelId(stat.id, "stat-group child");
    if (stat.visibleWhen !== undefined) {
      throw new Error(
        `${context} child "${stat.id}" sets visibleWhen — gate the whole group instead; a hidden cell would leave a gap in the strip.`,
      );
    }
    if (!stat.query || typeof stat.query !== "string") {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}" child "${stat.id}" has empty or non-string query.`,
      );
    }
    if (stat.valueField.length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}" child "${stat.id}" has empty valueField.`,
      );
    }
    validateDashboardValueFormat(featureName, screenId, stat.id, stat.valueFormat);
  }
}

function validateDashboardChartDisplay(
  featureName: string,
  screenId: string,
  panel: DashboardChartPanel,
): void {
  validateDashboardValueFormat(featureName, screenId, panel.id, panel.valueFormat);
  const where = `[Feature ${featureName}] Screen "${screenId}" (dashboard) chart-panel "${panel.id}"`;
  if (panel.scrollable !== undefined && typeof panel.scrollable !== "boolean") {
    throw new Error(`${where} has a non-boolean scrollable.`);
  }
  if (panel.scrollable === true && panel.chart !== "stacked-area") {
    throw new Error(
      `${where} sets scrollable on chart "${panel.chart}" — only "stacked-area" supports it.`,
    );
  }
  validateStackedAreaOnlyProps(where, panel);
  if (panel.legendTotals !== undefined && typeof panel.legendTotals !== "boolean") {
    throw new Error(`${where} has a non-boolean legendTotals.`);
  }
  for (const [key, color] of Object.entries(panel.seriesColors ?? {})) {
    if (typeof color !== "string" || color.trim() === "") {
      throw new Error(`${where} seriesColors["${key}"] must be a non-empty CSS color.`);
    }
  }
  for (const [kind, look] of Object.entries(panel.markerKinds ?? {})) {
    validateDashboardChartMarkerKind(`${where} markerKinds["${kind}"]`, look);
  }
  if (panel.ranges !== undefined) validateDashboardChartRanges(`${where} ranges`, panel.ranges);
}

function validateStackedAreaOnlyProps(where: string, panel: DashboardChartPanel): void {
  // skip: stacked-area is the one chart kind that supports these props
  if (panel.chart === "stacked-area") return;
  const stackedAreaOnly = (["markerKinds", "legendTotals", "ranges"] as const).filter(
    (prop) => panel[prop] !== undefined,
  );
  if (stackedAreaOnly.length > 0) {
    throw new Error(
      `${where} sets ${stackedAreaOnly.join(", ")} on chart "${panel.chart}" — only "stacked-area" supports it.`,
    );
  }
}

const DASHBOARD_CHART_TONES: ReadonlySet<string> = new Set([
  "positive",
  "negative",
  "active",
  "neutral",
] satisfies DashboardChartTone[]);

function validateDashboardChartMarkerKind(where: string, look: DashboardChartMarkerKind): void {
  if (look.tone === undefined && look.color === undefined) {
    throw new Error(`${where} needs a tone or a color.`);
  }
  if (look.tone !== undefined && !DASHBOARD_CHART_TONES.has(look.tone)) {
    throw new Error(
      `${where}.tone "${String(look.tone)}" is not one of ${[...DASHBOARD_CHART_TONES].join(", ")}.`,
    );
  }
  if (look.color !== undefined && (typeof look.color !== "string" || look.color.trim() === "")) {
    throw new Error(`${where}.color must be a non-empty CSS color.`);
  }
}

function validateDashboardChartRanges(where: string, ranges: DashboardChartRanges): void {
  if (ranges.options.length === 0) {
    throw new Error(`${where}.options is empty — declare at least one option.`);
  }
  const values = new Set<string>();
  for (const option of ranges.options) {
    if (option.value.length === 0 || option.label.length === 0) {
      throw new Error(`${where} option needs a non-empty value and label.`);
    }
    if (values.has(option.value)) {
      throw new Error(`${where}.options has duplicate value "${option.value}".`);
    }
    if (option.months !== undefined && (!Number.isInteger(option.months) || option.months <= 0)) {
      throw new Error(
        `${where} option "${option.value}" months "${String(option.months)}" must be a positive integer.`,
      );
    }
    values.add(option.value);
  }
  if (!values.has(ranges.default)) {
    throw new Error(
      `${where}.default "${ranges.default}" is not among the options (${[...values].join(", ")}).`,
    );
  }
}

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;
const MAX_VALUE_FORMAT_FRACTION_DIGITS = 4;

function validateDashboardValueFormat(
  featureName: string,
  screenId: string,
  panelId: string,
  valueFormat: DashboardValueFormat | undefined,
): void {
  // skip: valueFormat is optional, nothing to validate without it
  if (valueFormat === undefined) return;
  const where = `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panelId}" valueFormat`;
  if (!CURRENCY_CODE_RE.test(valueFormat.currency)) {
    throw new Error(
      `${where}.currency "${String(valueFormat.currency)}" must be a 3-letter uppercase ISO currency code.`,
    );
  }
  const digits = valueFormat.fractionDigits;
  if (
    digits !== undefined &&
    (!Number.isInteger(digits) || digits < 0 || digits > MAX_VALUE_FORMAT_FRACTION_DIGITS)
  ) {
    throw new Error(
      `${where}.fractionDigits "${String(digits)}" must be an integer from 0 to ${MAX_VALUE_FORMAT_FRACTION_DIGITS}.`,
    );
  }
}

export function validateDashboardCustomPanel(
  featureName: string,
  screenId: string,
  panel: DashboardCustomPanel,
): void {
  if (panel.component.react === undefined && panel.component.native === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) custom-panel "${panel.id}" has no component — ` +
        `declare a react/native component marker.`,
    );
  }
}

function validateDashboardQueryPanel(
  featureName: string,
  screenId: string,
  panel: Exclude<
    DashboardPanelDefinition,
    DashboardStatGroupPanel | DashboardCustomPanel | DashboardScreenPanel
  >,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  if (!panel.query || typeof panel.query !== "string") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}" has empty or non-string query.`,
    );
  }
  validateDashboardPanelSpan(featureName, screenId, panel);
  if (panel.kind === "stat") {
    if (panel.valueField.length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-panel "${panel.id}" has empty valueField.`,
      );
    }
    validateDashboardValueFormat(featureName, screenId, panel.id, panel.valueFormat);
  }
  validateDashboardPanelVisibleWhen(
    `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}"`,
    panel.visibleWhen,
  );
  if (panel.kind === "chart") validateDashboardChartDisplay(featureName, screenId, panel);
  if (panel.kind === "list") {
    if (panel.columns.length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) list-panel "${panel.id}" has an empty columns list.`,
      );
    }
    for (const col of panel.columns) {
      const normalized = normalizeListColumn(col);
      validateColumnRendererForm(featureName, screenId, normalized);
      if (normalized.refEntity !== undefined) {
        assertRefTargetRegistered(
          `[Feature ${featureName}] Screen "${screenId}" (dashboard) list-panel "${panel.id}"`,
          `column "${normalized.field}" (refEntity)`,
          normalized.refEntity,
          featureName,
          featureMap,
        );
      }
    }
  }
}

function validateDashboardFilterDefinition(
  featureName: string,
  screenId: string,
  filter: DashboardFilterDefinition,
): void {
  if (filter.id.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter has an empty id.`,
    );
  }
  if (filter.label.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter has an empty label.`,
    );
  }
  const hasOptions = filter.options !== undefined;
  const hasOptionsQuery = filter.optionsQuery !== undefined;
  if (hasOptions === hasOptionsQuery) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter must set exactly one of ` +
        `options/optionsQuery.`,
    );
  }
  if (hasOptions && (filter.options?.length ?? 0) === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter.options is empty — ` +
        `declare at least one option or use optionsQuery instead.`,
    );
  }
  if (hasOptionsQuery && filter.optionsQuery?.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) filter.optionsQuery is empty.`,
    );
  }
}

// Form-check für ListColumn-Renderer in der PlatformComponent-Form
// (`{ react: { __component: "Name" } }`). Der Server kennt die client-
// seitige columnRenderers-Map nicht — also nur prüfen ob die Struktur
// stimmt: wenn `react` als Object gesetzt ist, MUSS `__component` ein
// nicht-leerer String sein. Ein client-seitig ausgelassener Key löst
// nur eine Warnung aus, kein Boot-Fail.
export function validateColumnRendererForm(
  featureName: string,
  screenId: string,
  column: { readonly field: string; readonly renderer?: unknown },
): void {
  const renderer = column.renderer;
  // skip: nur die PlatformComponent-Form ({ react: { __component: "..." } })
  // wird strukturell validiert. Funktions-, String-QN- und null/undefined-
  // Renderer sind alle gültige andere Formen — kein Form-Fehler.
  if (renderer === null || typeof renderer !== "object") return;
  // @cast-boundary schema-walk — feature-config renderer-shape introspection
  const react = (renderer as { react?: unknown }).react;
  // skip: kein react-Branch → entweder native-only oder kein
  // PlatformComponent — beides außerhalb dieses Checks.
  if (react === undefined || react === null) return;
  if (typeof react !== "object") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `a non-object \`react\` branch — expected \`{ react: { __component: "Name" } }\`.`,
    );
  }
  // @cast-boundary schema-walk — feature-config react-branch introspection
  const component = (react as { __component?: unknown }).__component;
  // skip: ohne __component-Schlüssel ist das keine String-Key-Form
  // (z.B. ein zukünftiger direkter Component-Ref); nicht unsere Domäne.
  if (component === undefined) return;
  if (typeof component !== "string" || component.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `\`react.__component\` = ${JSON.stringify(component)} — expected a non-empty string identifying ` +
        `a client-side columnRenderers entry.`,
    );
  }
}

// Shared entity-target resolution for reference facets, refEntity columns
// (projectionList/relatedList) and refEntity fields (projectionDetail).
function assertRefTargetRegistered(
  prefix: string,
  subject: string,
  refTarget: string,
  currentFeatureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const target = parseRefTarget(refTarget, currentFeatureName);
  const targetFeature = featureMap.get(target.featureName);
  if (targetFeature === undefined) {
    throw new Error(
      `${prefix} ${subject} targets entity "${refTarget}", but feature "${target.featureName}" is not ` +
        `mounted — mount it and declare r.requires("${target.featureName}").`,
    );
  }
  if (targetFeature.entities?.[target.entityName] === undefined) {
    throw new Error(
      `${prefix} ${subject} targets entity "${refTarget}", which does not resolve to a ` +
        `registered entity. Known entities in feature "${target.featureName}": ` +
        `${
          Object.keys(targetFeature.entities ?? {})
            .sort()
            .join(", ") || "(none)"
        }.`,
    );
  }
}

// Facets (fw#2224) — unlike filter, a field inventory IS available here: the
// declared columns. A facet on a field with no column is almost always a
// typo (the user never sees the field anywhere), so this is hard-checked
// rather than just documented. Shared by projectionList and relatedList
// (fw#2740) — `prefix` carries the caller's own screen/section message lead-in.
//
// `type: "reference"` is exempt from the same-name-column rule (fw akte-
// bedienkonzept-2): it filters by an id field (e.g. "propertyId") but
// displays a different, human-readable column (e.g. "propertyLabel") — a
// column named after the filter field would almost never exist, and
// requiring one anyway would force apps to add a column no design calls
// for just to satisfy this check. Its own `entity` is mandatory on the type
// (TS, not just this validator) and is resolved below — that explicit,
// checked declaration is this facet type's field inventory, filling the
// same "not just a typo" role the column-name check plays for select/
// boolean facets. select/boolean facets keep the column requirement
// unchanged: both filter and display the same field, so a facet with no
// matching column is still almost always a typo.
function validateListFacets(
  prefix: string,
  facets: readonly ListFacetSpec[],
  columns: readonly ListColumnSpec[],
  currentFeatureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const columnFieldNames = new Set(columns.map((col) => normalizeListColumn(col).field));
  const seenFacetFields = new Set<string>();
  for (const facet of facets) {
    if (seenFacetFields.has(facet.field)) {
      throw new Error(`${prefix} declares facet "${facet.field}" more than once.`);
    }
    seenFacetFields.add(facet.field);
    if (facet.type !== "reference" && !columnFieldNames.has(facet.field)) {
      throw new Error(
        `${prefix} facet references field "${facet.field}" which is not a declared column. ` +
          `Known columns: ${[...columnFieldNames].sort().join(", ")}`,
      );
    }
    if (facet.type === "select" && facet.options.length === 0) {
      throw new Error(
        `${prefix} facet "${facet.field}" (type "select") has an empty options list — ` +
          `declare at least one option.`,
      );
    }
    if (facet.type === "reference") {
      assertRefTargetRegistered(
        prefix,
        `facet "${facet.field}" (type "reference")`,
        facet.entity,
        currentFeatureName,
        featureMap,
      );
      assertReferenceListHandlerRegistered(
        prefix,
        `facet "${facet.field}" (type "reference")`,
        facet.entity,
        currentFeatureName,
        featureMap,
      );
    }
  }
}

// The facet's options are loaded at render time by dispatching the target's
// list query (renderer useReferenceLookup, incl. its REFERENCE_LOOKUP_SOURCES
// override); a missing or unregistered handler is swallowed there and leaves
// a permanently empty dropdown, so it has to fail at boot instead.
function assertReferenceListHandlerRegistered(
  prefix: string,
  subject: string,
  refTarget: string,
  currentFeatureName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  const target = parseRefTarget(refTarget, currentFeatureName);
  const override = REFERENCE_LOOKUP_SOURCES[`${target.featureName}:${target.entityName}`];
  const expectedQn =
    override?.queryQn ??
    qualifyEntityName(target.featureName, "query", `${target.entityName}:list`);
  for (const feature of featureMap.values()) {
    for (const handlerName of Object.keys(feature.queryHandlers ?? {})) {
      // skip: expected list handler found
      if (qualifyEntityName(feature.name, "query", handlerName) === expectedQn) return;
    }
  }
  throw new Error(
    `${prefix} ${subject} loads its options from query "${expectedQn}", which is not a registered ` +
      `query handler — register the entity's list handler (defineEntityListHandler) or the facet renders an empty dropdown.`,
  );
}

export function findEntityFeature(
  entityName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): string | undefined {
  for (const [name, feature] of featureMap) {
    if (feature.entities?.[entityName]) return name;
  }
  return undefined;
}

export function buildUnknownFieldMessage(
  featureName: string,
  screenId: string,
  fieldName: string,
  entityName: string,
  knownFields: ReadonlySet<string>,
): string {
  const known = [...knownFields].sort().join(", ");
  return (
    `[Feature ${featureName}] Screen "${screenId}" references field "${fieldName}" ` +
    `which does not exist on entity "${entityName}" (known: ${known}).`
  );
}

export function collectScreenQns(features: readonly FeatureDefinition[]): Set<string> {
  const set = new Set<string>();
  for (const f of features) {
    for (const screenId of Object.keys(f.screens)) {
      set.add(qualifyEntityName(f.name, "screen", screenId));
    }
  }
  return set;
}

// Bare Screen-ids (ohne `<feature>:screen:`-Prefix) aus den qualifizierten
// QNs — für die app-weite Auflösung von navigate-Targets (s. validateScreens).
// Spiegelt den Runtime-Router, der bare ids feature-übergreifend matcht.
export function screenShortIdsFrom(allScreenQns: ReadonlySet<string>): Set<string> {
  const marker = ":screen:";
  const set = new Set<string>();
  for (const qn of allScreenQns) {
    const at = qn.indexOf(marker);
    if (at !== -1) set.add(qn.slice(at + marker.length));
  }
  return set;
}

// Short screen-id → every {featureName, screen} that registers it. The
// runtime router (create-app.tsx) resolves a bare navigate-target short-id by
// scanning ALL features and taking the first match — so two features
// registering the same short-id is a silent routing footgun (whichever
// feature comes first in the app's features[] array always wins, the other
// is unreachable by that id) and a prerequisite for the entityId-check below
// (which target screen it resolves to must be unambiguous).
export function collectScreensByShortId(
  features: readonly FeatureDefinition[],
): Map<string, ReadonlyArray<{ readonly featureName: string; readonly screen: ScreenDefinition }>> {
  const map = new Map<
    string,
    Array<{ readonly featureName: string; readonly screen: ScreenDefinition }>
  >();
  for (const f of features) {
    for (const [screenId, screen] of Object.entries(f.screens)) {
      const entries = map.get(screenId) ?? [];
      entries.push({ featureName: f.name, screen });
      map.set(screenId, entries);
    }
  }
  return map;
}
