import { isListFilterAllowed } from "../../db/entity-field-encryption.ts";
import { rowMetaFieldNames } from "../../db/table-builder.ts";
import { qualifyEntityName } from "../qualified-name.ts";
import { getAllowedFilterOps, isFieldFilterable } from "../screen-filter-ops.ts";
import { normalizeListColumn } from "../screen-helpers.ts";
import type { EntityDefinition } from "../types/index.ts";
import type { EntityListScreenDefinition, RowAction, ToolbarAction } from "../types/screen.ts";
import { LIST_ROW_META_COLUMN_NAMES } from "./entity-list-screens.ts";
import { validateListTableOptions } from "./list-table-options.ts";
import {
  assertWriteHandlerRegistered,
  rejectRedirectOnListRowAction,
  resolveRowActionNavigateTarget,
  validateActionFieldRefs,
  validateAtMostOneRowClick,
  validateDrawerTargetAction,
  validateRowActionNavigateParams,
} from "./screens-actions.ts";
import {
  buildUnknownFieldMessage,
  listActionContext,
  rejectEmptyColumns,
  rejectNonArrayInFilter,
  resolveScreenEntity,
  type ScreenValidationContext,
  validateListColumnRendering,
} from "./screens-kind-shared.ts";
import { validateRelatedListSection, validateRowActionTarget } from "./screens-lists.ts";

type EntityListFields = {
  readonly entityDef: EntityDefinition;
  readonly fieldNames: ReadonlySet<string>;
  readonly columnFieldNames: ReadonlySet<string>;
  readonly rowMeta: ReadonlySet<string>;
};

function resolveEntityListFields(
  ctx: ScreenValidationContext,
  screenId: string,
  entityName: string,
): EntityListFields {
  const entityDef = resolveScreenEntity(ctx, screenId, entityName);
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
  return { entityDef, fieldNames, columnFieldNames, rowMeta };
}

function validateEntityListColumns(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: EntityListScreenDefinition,
  fields: EntityListFields,
): void {
  const featureName = ctx.feature.name;
  rejectEmptyColumns(featureName, screenId, "entityList", screen.columns.length);
  for (const col of screen.columns) {
    const normalized = normalizeListColumn(col);
    // A row-meta column (id/tenantId/version/insertedAt/modifiedAt/...) is a
    // real DB column without being a declared entity field — e.g. a
    // SystemAdmin cross-tenant list exposing tenantId. Accept it like a
    // regular field name — but only the columns computeListViewModel can
    // actually render (LIST_ROW_META_COLUMN_NAMES), not the wider
    // softDelete-aware rowMeta set used for payload/visible refs.
    //
    // A virtual presentational column (drawn by a columnRenderer component
    // from the row, e.g. tag chips) needs BOTH a label AND a renderer —
    // renderer is what actually makes it "virtual" (label alone still
    // needs list.ts's virtual-branch to have something to draw). A column
    // with neither matching a real field/row-meta column NOR a renderer is
    // a typo worth failing the boot.
    if (
      !fields.columnFieldNames.has(normalized.field) &&
      !LIST_ROW_META_COLUMN_NAMES.has(normalized.field) &&
      !(normalized.label !== undefined && normalized.renderer !== undefined)
    ) {
      throw new Error(
        buildUnknownFieldMessage(
          featureName,
          screenId,
          normalized.field,
          screen.entity,
          fields.columnFieldNames,
        ),
      );
    }
    validateListColumnRendering(ctx, screenId, "entityList", normalized);
  }
}

function validateEntityListDefaultSort(
  featureName: string,
  screenId: string,
  defaultSort: NonNullable<EntityListScreenDefinition["defaultSort"]>,
  fields: EntityListFields,
): void {
  const sortField = defaultSort.field;
  if (!fields.fieldNames.has(sortField)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) defaultSort references unknown ` +
        `field "${sortField}". Known fields: ${[...fields.fieldNames].sort().join(", ")}`,
    );
  }
  // `sortable: true` is required so the UI never sorts on a column that has
  // no server-side DB index or that the schema deliberately keeps unsortable
  // (audit fields, computed values). `sortable` currently
  // exists only on TextFieldDef; the `in` narrowing also permits other
  // field types without an explicit flag, which is acceptable because
  // Number/Date fields are naturally sortable. Authors can mark them
  // sortable when their field type supports it.
  const fieldDef = fields.entityDef.fields[sortField];
  const isSortable = fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true;
  if (!isSortable) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) defaultSort.field "${sortField}" ` +
        `is not sortable. Set sortable: true on the field definition or pick another field.`,
    );
  }
}

// Screen filters are checked in three layers:
//   1) The field exists on the entity; a typo would otherwise produce an
//      empty list instead of a clear boot failure.
//   2) The field has `filterable: true`, preventing accidental filtering
//      of audit, computed, or encrypted fields.
//   3) The operation matches the field type, so lt/gt on text fields
//      fails at boot instead of causing surprising runtime behavior.
// Additionally, "in" requires a readonly array.
function validateEntityListFilter(
  featureName: string,
  screenId: string,
  filter: NonNullable<EntityListScreenDefinition["filter"]>,
  fields: EntityListFields,
): void {
  const filterField = filter.field;
  if (!fields.fieldNames.has(filterField)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) filter references unknown ` +
        `field "${filterField}". Known fields: ${[...fields.fieldNames].sort().join(", ")}`,
    );
  }
  if (!isListFilterAllowed(fields.entityDef, filterField, filter)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) filter references field ` +
        `"${filterField}" which is encrypted, personal or secret, so the list handler rejects ` +
        `this filter at runtime. Only op "eq" works on a personal field with find: "exact" or ` +
        `"fuzzy"; otherwise drop the filter or filter on another field.`,
    );
  }
  const fieldDef = fields.entityDef.fields[filterField];
  if (fieldDef !== undefined && !isFieldFilterable(fieldDef)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) filter references field ` +
        `"${filterField}" which is not filterable. Set filterable: true on the field ` +
        `definition or pick another field.`,
    );
  }
  if (fieldDef !== undefined) {
    const allowedOps = getAllowedFilterOps(fieldDef);
    if (!allowedOps.includes(filter.op)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (entityList) filter.op ` +
          `"${filter.op}" is not allowed on field "${filterField}" ` +
          `(type "${fieldDef.type}"). Allowed ops: ${allowedOps.join(", ") || "(none)"}.`,
      );
    }
  }
  rejectNonArrayInFilter(featureName, screenId, "entityList", filter);
}

// The renderer's default-entityId fallback (row["id"]) only fires for a
// same-feature entityEdit target — it can't safely guess the id for a screen
// owned by a different feature. Cross-feature + entityEdit therefore MUST set
// an explicit entityId, or the edit screen silently opens with no entity
// context at runtime. Entity-targets are exempt: the renderer always supplies
// an id for them (explicit entityId, else row["id"]), regardless of which
// feature the resolved detailFor screen belongs to.
function rejectCrossFeatureEditTargetWithoutEntityId(
  featureName: string,
  screenId: string,
  action: Extract<RowAction, { readonly kind: "navigate" }>,
  target: ReturnType<typeof resolveRowActionNavigateTarget>,
): void {
  if (
    action.screen !== undefined &&
    target !== undefined &&
    target.featureName !== featureName &&
    target.screen.type === "entityEdit" &&
    action.entityId === undefined
  ) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) rowAction "${action.id}" ` +
        `navigates cross-feature to entityEdit screen "${action.screen}" (feature ` +
        `"${target.featureName}") without an explicit entityId field — the renderer's ` +
        `same-feature row["id"] fallback does not apply across features. Set entityId to ` +
        `the row field that names the target entity's id.`,
    );
  }
}

// Pin rowActions at boot: a navigate target must exist and a writeHandler QN
// must be registered. Typos would otherwise only surface on the first click as
// "Screen not found" or a 404.
function validateEntityListRowAction(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: EntityListScreenDefinition,
  fields: EntityListFields,
  action: RowAction,
): void {
  const featureName = ctx.feature.name;
  rejectRedirectOnListRowAction(featureName, screenId, "entityList", action);
  if (action.kind === "navigate") {
    const target = resolveRowActionNavigateTarget(
      featureName,
      screenId,
      "entityList",
      "rowAction",
      action,
      ctx.allScreenQns,
      ctx.navTargetShortIds,
      ctx.screensByShortId,
      ctx.detailForScreens,
    );
    rejectCrossFeatureEditTargetWithoutEntityId(featureName, screenId, action, target);
    // params only have a reader in actionForm and entityEdit-CREATE; on
    // projectionDetail/dashboard/configEdit/entityEdit-update they are
    // silently ignored at runtime. `custom` is deliberately exempt: it renders
    // an app-registered component the framework has no visibility into, so
    // flagging it would be a false positive on working code.
    //
    // Whether an entityEdit target lands in create or update mode is decided
    // by the same rule the renderer's runNavigate() uses: an explicit
    // entityId always forces update mode, and (absent an explicit entityId) a
    // same-entity target gets row["id"] auto-injected — only a cross-entity
    // target with no explicit entityId reaches create.
    validateRowActionNavigateParams(
      featureName,
      screenId,
      "entityList",
      screen.entity,
      action,
      target,
    );
  } else {
    validateRowActionTarget(
      listActionContext(
        ctx,
        screenId,
        "entityList",
        screen.entity,
        `Screen "${screenId}" (entityList)`,
      ),
      "rowAction",
      "rowAction",
      action,
    );
  }
  validateActionFieldRefs(
    featureName,
    screenId,
    "rowAction",
    action.id,
    action,
    fields.fieldNames,
    fields.rowMeta,
  );
}

// toolbarActions, analogous to rowActions: misspelled navigate targets and
// unregistered writeHandler QNs fail at boot instead of on the first click.
function validateEntityListToolbarAction(
  ctx: ScreenValidationContext,
  screenId: string,
  fields: EntityListFields,
  action: ToolbarAction,
): void {
  const featureName = ctx.feature.name;
  if (action.kind === "navigate") {
    const candidateQn = qualifyEntityName(featureName, "screen", action.screen);
    if (!ctx.allScreenQns.has(candidateQn) && !ctx.navTargetShortIds.has(action.screen)) {
      throw new Error(
        `[Feature ${featureName}] Screen "${screenId}" (entityList) toolbarAction "${action.id}" ` +
          `navigate-target "${action.screen}" does not resolve to a registered screen in any feature. Use "<feature>:screen:<id>" of an existing screen.`,
      );
    }
    if (action.tab !== undefined) {
      resolveRowActionNavigateTarget(
        featureName,
        screenId,
        "entityList",
        "toolbarAction",
        action,
        ctx.allScreenQns,
        ctx.navTargetShortIds,
        ctx.screensByShortId,
        ctx.detailForScreens,
      );
    }
  } else if (action.kind === "drawer") {
    validateDrawerTargetAction(
      featureName,
      screenId,
      "entityList",
      "toolbarAction",
      action,
      ctx.feature.screens,
    );
  } else {
    assertWriteHandlerRegistered(
      featureName,
      `Screen "${screenId}" (entityList) toolbarAction "${action.id}"`,
      action.handler,
      ctx.allWriteHandlerQns,
    );
  }
  validateActionFieldRefs(
    featureName,
    screenId,
    "toolbarAction",
    action.id,
    action,
    fields.fieldNames,
    fields.rowMeta,
  );
}

function validateEntityListExpandableRow(
  ctx: ScreenValidationContext,
  screenId: string,
  expandableRow: NonNullable<EntityListScreenDefinition["expandableRow"]>,
  fields: EntityListFields,
): void {
  validateRelatedListSection({
    featureName: ctx.feature.name,
    featureMap: ctx.featureMap,
    screenId,
    screenType: "entityList expandableRow",
    where: `Screen "${screenId}" (entityList) expandableRow "${expandableRow.title}"`,
    section: expandableRow,
    screens: ctx.feature.screens,
    allWriteHandlerQns: ctx.allWriteHandlerQns,
    allScreenQns: ctx.allScreenQns,
    navTargetShortIds: ctx.navTargetShortIds,
    screensByShortId: ctx.screensByShortId,
    detailForScreens: ctx.detailForScreens,
  });
  // Toolbar actions of the expansion evaluate against the host row.
  for (const action of expandableRow.toolbarActions ?? []) {
    validateActionFieldRefs(
      ctx.feature.name,
      screenId,
      "toolbarAction",
      action.id,
      action,
      fields.fieldNames,
      fields.rowMeta,
    );
  }
}

export function validateEntityListScreen(
  ctx: ScreenValidationContext,
  screenId: string,
  screen: EntityListScreenDefinition,
): void {
  const featureName = ctx.feature.name;
  const fields = resolveEntityListFields(ctx, screenId, screen.entity);
  validateEntityListColumns(ctx, screenId, screen, fields);
  // Validate pagination, sorting, and search at boot so authoring errors
  // fail before runtime debugging of empty or incorrectly sorted lists.
  if (screen.pageSize !== undefined && screen.pageSize <= 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) has pageSize=${screen.pageSize} — ` +
        `must be a positive integer.`,
    );
  }
  validateListTableOptions(
    `[Feature ${featureName}] Screen "${screenId}" (entityList)`,
    screen.table,
    screen.columns,
    true,
  );
  if (screen.defaultSort !== undefined) {
    validateEntityListDefaultSort(featureName, screenId, screen.defaultSort, fields);
  }
  if (
    screen.createScreen !== undefined &&
    !Object.hasOwn(ctx.feature.screens, screen.createScreen)
  ) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" (entityList) createScreen ` +
        `"${screen.createScreen}" does not resolve to a registered screen in this feature. ` +
        `Known screens in this feature: ${Object.keys(ctx.feature.screens).sort().join(", ") || "(none)"}.`,
    );
  }
  if (screen.filter !== undefined) {
    validateEntityListFilter(featureName, screenId, screen.filter, fields);
  }
  if (screen.rowActions !== undefined) {
    for (const action of screen.rowActions) {
      validateEntityListRowAction(ctx, screenId, screen, fields, action);
    }
    validateAtMostOneRowClick(featureName, screenId, "entityList", screen.rowActions);
  }
  for (const action of screen.toolbarActions ?? []) {
    validateEntityListToolbarAction(ctx, screenId, fields, action);
  }
  if (screen.expandableRow !== undefined) {
    validateEntityListExpandableRow(ctx, screenId, screen.expandableRow, fields);
  }
}
