// Screen validation, including the dashboard-panel sub-validators.
// Dashboard stays here (not a separate dashboard.ts) — validateScreens
// calls validateDashboardScreen and the dashboard validators call back
// into validateColumnRendererForm, splitting them would create a
// same-folder require cycle.

import { NO_WIDGET_FIELD_TYPES } from "@cosmicdrift/kumiko-types/fields";
import { rowMetaFieldNames } from "../../db/table-builder";
import { isValidQn, qualifyEntityName } from "../qualified-name";
import { getAllowedFilterOps, isFieldFilterable } from "../screen-filter-ops";
import { isExtensionEditSection, normalizeEditField, normalizeListColumn } from "../screen-helpers";
import type { EntityDefinition, FeatureDefinition } from "../types";
import type {
  DashboardCustomPanel,
  DashboardFilterDefinition,
  DashboardPanelDefinition,
  DashboardScreenDefinition,
  DashboardStatGroupPanel,
  EditFieldSpec,
  EditLayout,
  FieldCondition,
  RowAction,
  RowActionNavigateBase,
  RowFieldExtractor,
  ScreenDefinition,
  ToolbarAction,
} from "../types/screen";

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
  screenType: "entityList" | "projectionList" | "projectionDetail",
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
    const extractedKeys =
      "pick" in action.params ? action.params.pick : Object.keys(action.params.map);
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

  const isEntityEditUpdate =
    target.screen.type === "entityEdit" &&
    (action.entityId !== undefined ||
      (screenEntity !== undefined && target.screen.entity === screenEntity));
  if (
    (target.screen.type !== "actionForm" && target.screen.type !== "entityEdit") ||
    isEntityEditUpdate
  ) {
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
        `sets params on navigate-target ${targetDescriptor} which ${reason} — only actionForm ` +
        `and entityEdit-create targets read URL search params as initial values. Remove the ` +
        `params extractor or retarget to an actionForm / cross-entity entityEdit-create screen.`,
    );
  }
}

// Wizard layouts (mode: "wizard") need >= 2 titled sections — a single or
// untitled step would leave the progress indicator blank, so both fail at
// boot rather than as a broken step UI.
function validateWizardLayout(
  featureName: string,
  screenId: string,
  screenType: "entityEdit" | "actionForm" | "configEdit",
  layout: EditLayout,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
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

// Tier 2.7e-3: deklarative Feld-Referenzen einer Action gegen die Entity-
// Felder pinnen — ein Tippfehler in pick/map-Quellfeldern oder
// visible.field erzeugte sonst still `undefined` im Payload bzw. dauerhaft
// falsche Sichtbarkeit (gleiche "Typo fällt erst beim Klick"-Klasse wie
// navigate/handler).
function validateActionFieldRefs(
  featureName: string,
  screenId: string,
  actionKind: "rowAction" | "toolbarAction",
  actionId: string,
  action: RowAction | ToolbarAction,
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
function resolveScreenTargetQn(featureName: string, target: string): string {
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
// screen type (fw#2225).
function validateToolbarDrawerAction(
  featureName: string,
  screenId: string,
  screenKind: string,
  action: Extract<ToolbarAction, { kind: "drawer" }>,
  screens: FeatureDefinition["screens"],
): void {
  const target = screens[action.screen];
  if (target === undefined) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) toolbarAction "${action.id}" ` +
        `drawer-target "${action.screen}" does not resolve to a registered screen in this feature. ` +
        `kind:"drawer" only resolves same-feature screens (unlike kind:"navigate", which can target ` +
        `screens in any feature) — the drawer mounts the target inline using this feature's schema. ` +
        `Known screens in this feature: ${[...Object.keys(screens)].sort().join(", ") || "(none)"}.`,
    );
  }
  if (target.type !== "actionForm") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (${screenKind}) toolbarAction "${action.id}" ` +
        `drawer-target "${action.screen}" is a "${target.type}" screen, not an actionForm. ` +
        `kind:"drawer" mounts an actionForm inside a Drawer widget — point "screen" at an ` +
        `actionForm screen, or use kind:"navigate" for a full-page target.`,
    );
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

function resolveRowActionNavigateTarget(
  featureName: string,
  screenId: string,
  screenType: "entityList" | "projectionList" | "projectionDetail",
  actionLabel: "rowAction" | "action",
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
  return screensByShortId.get(action.screen)?.[0];
}

export function validateScreens(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  allWriteHandlerQns: ReadonlySet<string>,
  allScreenQns: ReadonlySet<string>,
  allConfigKeyQns: ReadonlySet<string>,
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
  for (const [screenId, screen] of Object.entries(feature.screens)) {
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
        validateColumnRendererForm(feature.name, screenId, normalizeListColumn(col));
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
      // Facets (fw#2224) — unlike filter, a field inventory IS available
      // here: the declared columns. A facet on a field with no column is
      // almost always a typo (the user never sees the field anywhere), so
      // this is hard-checked rather than just documented.
      if (screen.facets !== undefined) {
        const columnFieldNames = new Set(
          screen.columns.map((col) => normalizeListColumn(col).field),
        );
        const seenFacetFields = new Set<string>();
        for (const facet of screen.facets) {
          if (seenFacetFields.has(facet.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionList) declares facet ` +
                `"${facet.field}" more than once.`,
            );
          }
          seenFacetFields.add(facet.field);
          if (!columnFieldNames.has(facet.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionList) facet references field ` +
                `"${facet.field}" which is not a declared column. Known columns: ` +
                `${[...columnFieldNames].sort().join(", ")}`,
            );
          }
          if (facet.type === "select" && facet.options.length === 0) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionList) facet "${facet.field}" ` +
                `(type "select") has an empty options list — declare at least one option.`,
            );
          }
        }
      }
      if (screen.rowActions !== undefined) {
        for (const action of screen.rowActions) {
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
          }
        }
        validateAtMostOneRowClick(feature.name, screenId, "projectionList", screen.rowActions);
      }
      // Only drawer-kind is validated here — navigate/writeHandler toolbarActions
      // on projectionList have no boot check yet (pre-existing gap, out of
      // scope for fw#2225).
      if (screen.toolbarActions !== undefined) {
        for (const action of screen.toolbarActions) {
          if (action.kind === "drawer") {
            validateToolbarDrawerAction(
              feature.name,
              screenId,
              "projectionList",
              action,
              feature.screens,
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
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (isExtensionEditSection(section)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) extension section ` +
              `"${section.title}" is not supported — projectionDetail has no entity for an extension ` +
              `section to persist against.`,
          );
        }
        if (section.kind === "relatedList") {
          if (!section.query || typeof section.query !== "string") {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                `(relatedList) has empty or non-string query.`,
            );
          }
          if (screen.layout.mode === "wizard") {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                `is kind "relatedList" in a wizard layout — a read-only list is not supported in a ` +
                `stepped form. Remove mode: "wizard" or drop the relatedList section.`,
            );
          }
          if (section.rowClick !== undefined) {
            const targetEntity = section.rowClick.entity;
            const hasDetailScreen = [...featureMap.values()].some((f) =>
              Object.values(f.screens).some((s) => s.detailFor === targetEntity),
            );
            if (!hasDetailScreen) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                  `(relatedList) rowClick targets entity "${targetEntity}", but no screen declares ` +
                  `detailFor: "${targetEntity}". Add detailFor: "${targetEntity}" to the screen that shows it.`,
              );
            }
          }
          continue;
        }
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
      }
      // Header actions reuse RowAction (the displayed record stands in for
      // the row), so the same navigate/writeHandler existence checks as
      // entityList/projectionList apply. `rowClick` is rejected outright —
      // a detail screen has no row to click.
      if (screen.actions !== undefined) {
        for (const action of screen.actions) {
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
      validateDashboardScreen(feature.name, screenId, screen);
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
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
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
        if (!allConfigKeyQns.has(qualified)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" → ` +
              `Config-Key "${qualified}" ist in keiner Feature-Registry deklariert. Tippfehler? ` +
              `Erwartetes Format: "<feature>:config:<short>". Bekannte Keys: ${
                [...allConfigKeyQns].sort().join(", ") || "(keine)"
              }`,
          );
        }
      }
      continue;
    }

    if (screen.type === "actionForm") {
      // Tier 2.7d: Action-Form-Screens haben keinen entity-Link, nur
      // einen Write-Handler-QN + Inline-Fields. Sechs Author-Code-
      // Checks am Boot:
      //   1) handler ist non-empty String.
      //   2) handler ist als Write-Handler registriert (cross-feature-
      //      Lookup gegen die collected QN-Map). Tippfehler/umbenannte
      //      Handler fallen sonst erst beim ersten Klick als 404 auf.
      //   3) fields-Map ist non-empty.
      //   4) Jeder Field-Eintrag hat einen `type`-Discriminator
      //      (Tippfehler in Schema → Renderer crasht stumm sonst).
      //   5) layout.sections + jedes referenced field existiert in
      //      fields.
      //   6) redirect (wenn gesetzt) verweist auf einen registrierten
      //      Screen-QN (Cross-Feature ok).
      if (!screen.handler || typeof screen.handler !== "string") {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has empty or non-string handler.`,
        );
      }
      if (!allWriteHandlerQns.has(screen.handler)) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) handler "${screen.handler}" ` +
            `is not a registered write-handler. Check the QN spelling (expected ` +
            `"<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
        );
      }
      const fieldNames = new Set(Object.keys(screen.fields));
      if (fieldNames.size === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has empty fields map — ` +
            `declare at least one field.`,
        );
      }
      // Jeder Field-Eintrag muss einen `type`-Discriminator haben.
      // Author-Tippfehler (`title: { required: true }` ohne type) →
      // RenderField fällt zur Laufzeit auf den Default-Renderer und
      // schickt einen leeren String — silent broken. Boot-Fail ist
      // klarer. `type as unknown` weil FieldDefinition als Union nur
      // bekannte Strings erlaubt; wir prüfen Author-Code, der ggf.
      // den Type-Check umgangen hat.
      for (const [fname, fdef] of Object.entries(screen.fields)) {
        // @cast-boundary schema-walk — feature-config inspection (Author may circumvent type-check)
        const ftype = (fdef as { type?: unknown }).type;
        if (typeof ftype !== "string" || ftype.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) field "${fname}" has no ` +
              `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
          );
        }
      }
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (isExtensionEditSection(section)) {
          if (section.component?.react === undefined && section.component?.native === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (actionForm) extension section ` +
                `"${section.title}" has no component — declare a react/native component marker.`,
            );
          }
          continue;
        }
        if (section.kind === "relatedList") {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) relatedList section ` +
              `"${section.title}" is not supported — relatedList is a projectionDetail-only ` +
              `primitive (fw#2166).`,
          );
        }
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (actionForm) layout references unknown field ` +
                `"${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
            );
          }
        }
      }
      validateWizardLayout(feature.name, screenId, "actionForm", screen.layout, featureMap);
      if (screen.redirect !== undefined) {
        // redirect ist entweder die kurze Screen-ID (same-feature, z.B.
        // "item-list") oder eine voll-qualifizierte Cross-Feature-QN
        // (`<feature>:screen:<id>`) — der Renderer strippt letztere beim
        // Navigieren auf die kurze ID (lastSegment), die der nav-Router
        // app-weit auflöst (#1946).
        validateScreenNavTarget(
          feature.name,
          screenId,
          "actionForm",
          "redirect",
          screen.redirect,
          allScreenQns,
          feature.screens,
        );
      }
      if (typeof screen.cancelTarget === "string") {
        // Gleiche Regel wie redirect — `false` (kein Cancel-Button)
        // braucht keine Validierung.
        validateScreenNavTarget(
          feature.name,
          screenId,
          "actionForm",
          "cancelTarget",
          screen.cancelTarget,
          allScreenQns,
          feature.screens,
        );
      }
      continue;
    }

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
        // A virtual presentational column (drawn by a columnRenderer component
        // from the row, e.g. tag chips) needs BOTH a label AND a renderer —
        // renderer is what actually makes it "virtual" (label alone still
        // needs list.ts's virtual-branch to have something to draw; without
        // a renderer the column would render nothing). A column with neither
        // matching a real field NOR a renderer is a typo worth failing the boot.
        if (
          !columnFieldNames.has(normalized.field) &&
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
          } else if (action.kind === "drawer") {
            validateToolbarDrawerAction(
              feature.name,
              screenId,
              "entityList",
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
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
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
      if (screen.redirect !== undefined) {
        // Same rule as actionForm's redirect: short screen-ID (same-feature)
        // or a fully-qualified cross-feature QN (#1946).
        validateScreenNavTarget(
          feature.name,
          screenId,
          "entityEdit",
          "redirect",
          screen.redirect,
          allScreenQns,
          feature.screens,
        );
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
    } else {
      validateDashboardQueryPanel(featureName, screenId, panel);
    }
  }

  if (screen.filter !== undefined) {
    validateDashboardFilterDefinition(featureName, screenId, screen.filter);
  }
}

function validateDashboardStatGroupPanel(
  featureName: string,
  screenId: string,
  panel: DashboardStatGroupPanel,
  addPanelId: (id: string, context: string) => void,
): void {
  if (panel.stats.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-group "${panel.id}" has an empty stats list.`,
    );
  }
  for (const stat of panel.stats) {
    addPanelId(stat.id, "stat-group child");
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
  }
}

function validateDashboardCustomPanel(
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
  panel: Exclude<DashboardPanelDefinition, DashboardStatGroupPanel | DashboardCustomPanel>,
): void {
  if (!panel.query || typeof panel.query !== "string") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) panel "${panel.id}" has empty or non-string query.`,
    );
  }
  if (panel.kind === "stat" && panel.valueField.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (dashboard) stat-panel "${panel.id}" has empty valueField.`,
    );
  }
  if (panel.kind === "list") {
    if (panel.columns.length === 0) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (dashboard) list-panel "${panel.id}" has an empty columns list.`,
      );
    }
    for (const col of panel.columns) {
      validateColumnRendererForm(featureName, screenId, normalizeListColumn(col));
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
