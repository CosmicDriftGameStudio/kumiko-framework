// Screen validation entry point. The sub-validators live in the screens-*.ts
// siblings; dependencies only point one way (screens.ts -> dashboard/forms/lists
// -> actions), so there is no same-folder require cycle.

import { SELECT_OPTION_TONES } from "@cosmicdrift/kumiko-types/fields";
import { isListFilterAllowed } from "../../db/entity-field-encryption.ts";
import { rowMetaFieldNames } from "../../db/table-builder.ts";
import { isEncryptedAtRest } from "../config-helpers.ts";
import { qualifyEntityName } from "../qualified-name.ts";
import { getAllowedFilterOps, isFieldFilterable } from "../screen-filter-ops.ts";
import {
  isExtensionEditSection,
  isFieldsEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  normalizeListColumn,
  sectionFieldSpecs,
} from "../screen-helpers.ts";
import type { ConfigKeyDefinition, FeatureDefinition } from "../types/index.ts";
import type { ScreenDefinition } from "../types/screen.ts";
import { LIST_ROW_META_COLUMN_NAMES } from "./entity-list-screens.ts";
import type { NavigateTargetLookups } from "./screens-actions.ts";
import {
  isRowClickAction,
  rejectRedirectOnListRowAction,
  resolveRowActionNavigateTarget,
  validateActionFieldRefs,
  validateActionHasIcon,
  validateAtMostOneRowClick,
  validateClientActionName,
  validateDrawerTargetAction,
  validateNavigateActionTab,
  validatePrimaryActionTarget,
  validateRecordActionRedirect,
  validateRedirectTarget,
  validateRowActionNavigateParams,
  validateScreenVisibleWhen,
} from "./screens-actions.ts";
import {
  validateDashboardActions,
  validateDashboardRecordBinding,
  validateDashboardScreen,
} from "./screens-dashboard.ts";
import {
  isWriteOnlyField,
  rejectWriteOnlyFormField,
  validateConfigEditSecretField,
  validateEditFieldExtras,
  validateFieldFormRefs,
  validateFieldsXorGroups,
  validateFillActionTarget,
  validateFormSelectOptions,
  validateInlineFormScreen,
  validateNoWidgetRequiredField,
  validateSecretMintConfirm,
  validateTabSections,
  validateWizardLayout,
} from "./screens-forms.ts";
import {
  assertRefTargetRegistered,
  rejectInertColumnSortable,
  validateColumnRendererForm,
  validateExplicitListScreenExists,
  validateListActionTargets,
  validateListFacets,
  validateRelatedListSection,
  validateScreenHasNavArea,
} from "./screens-lists.ts";
import { isSelectOptionTone } from "./select-option-tone.ts";

export {
  readsNavigateParamsAsFormPrefill,
  resolveScreenTargetQn,
  rowFieldExtractorKeys,
  validateActionFieldRefs,
  validateActionHasIcon,
  validateDrawerPrefillKeys,
  validateScreenShortIdCollisions,
} from "./screens-actions.ts";
export { validateDashboardCustomPanel, validateDashboardScreenPanel } from "./screens-dashboard.ts";
export { validateColumnRendererForm } from "./screens-lists.ts";

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
  // navigate targets (rowAction/toolbarAction) may point cross-feature: the
  // runtime router (create-app) resolves a bare screenId app-wide across ALL
  // features (a declarative list in the entity's owning feature navigates to
  // the consumer app's custom editors this way). The validator mirrors that:
  // same feature OR any feature. redirect/cancelTarget additionally accept a
  // fully qualified cross-feature QN (resolveScreenTargetQn); short IDs
  // stay same-feature as before.
  const navTargetShortIds = screenShortIdsFrom(allScreenQns);
  const navigateLookups: NavigateTargetLookups = {
    allScreenQns,
    navTargetShortIds,
    screensByShortId,
    detailForScreens,
  };
  for (const [screenId, screen] of Object.entries(feature.screens)) {
    validateExplicitListScreenExists(feature.name, screenId, screen, screensByShortId);
    if (
      (screen.type === "entityList" || screen.type === "projectionList") &&
      screen.emptyState?.action !== undefined
    ) {
      validateActionHasIcon(
        feature.name,
        screenId,
        screen.type,
        "emptyState action",
        screen.emptyState.action,
      );
      validateListActionTargets(
        {
          featureName: feature.name,
          screenId,
          screenType: screen.type,
          screenEntity: undefined,
          where: `Screen "${screenId}" (${screen.type})`,
          screens: feature.screens,
          allWriteHandlerQns,
          ...navigateLookups,
        },
        "emptyState action",
        screen.emptyState.action,
      );
    }
    // Output of buildAppSchema, which overwrites it — an authored value would be a silent no-op.
    if (
      (screen.type === "entityEdit" ||
        screen.type === "actionForm" ||
        screen.type === "secretMint") &&
      screen.urlPrefillFields !== undefined
    ) {
      throw new Error(
        `[Feature ${feature.name}] Screen "${screenId}" (${screen.type}) sets urlPrefillFields — ` +
          `it is derived from navigate params by buildAppSchema; declare params on the navigating action instead.`,
      );
    }
    if (
      screen.type !== "actionForm" &&
      screen.type !== "secretMint" &&
      "submitPrefilled" in screen &&
      screen.submitPrefilled !== undefined
    ) {
      throw new Error(
        `[Feature ${feature.name}] Screen "${screenId}" (${screen.type}) sets submitPrefilled — ` +
          `only actionForm and secretMint screens support it. Remove it.`,
      );
    }
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
      // Query-driven, no entity, so only query + columns are checked (the
      // column fields cannot be checked against an entity; they resolve
      // against the projection rows at render time).
      if (!screen.query || typeof screen.query !== "string") {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionList) has empty or non-string query. Set query to a registered query name.`,
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
        rejectInertColumnSortable(feature.name, screenId, "projectionList", normalizedCol);
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
      // Screen filter — field existence can't be checked without
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
            `filter.value to be a readonly array. Pass an array as filter.value.`,
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
          } else if (action.kind === "clientAction") {
            validateClientActionName(feature.name, screenId, "projectionList", "rowAction", action);
          } else if (!allWriteHandlerQns.has(action.handler)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionList) rowAction "${action.id}" ` +
                `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
            );
          }
        }
        validateAtMostOneRowClick(feature.name, screenId, "projectionList", screen.rowActions);
      }
      // Plain navigate toolbarActions (no tab) have no boot check yet.
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
          } else if (action.kind === "writeHandler" && !allWriteHandlerQns.has(action.handler)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionList) toolbarAction "${action.id}" ` +
                `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
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
      // Query-driven like projectionList, but a single row plus layout instead
      // of columns. No entity check is possible: fields resolve against the
      // query response at render time, not against an entity.
      if (!screen.query || typeof screen.query !== "string") {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) has empty or non-string query. Set query to a registered query name.`,
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
      // action (defaultEditAction in kumiko-screen.tsx) navigates
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
          if (
            isFieldsEditSection(section) &&
            "groups" in section &&
            section.actions !== undefined
          ) {
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
          const field = metric.field;
          if (typeof metric.label !== "string" || metric.label.length === 0) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) metric "${field}" has ` +
                `no "label" — every metric needs an i18n label key, ` +
                `there is no fallback to the raw column name.`,
            );
          }
          const navigate = metric.navigate;
          if (navigate !== undefined) {
            if (navigate.screen === undefined && navigate.entity === undefined) {
              if (
                navigate.tab !== undefined &&
                !screen.layout.sections.some((section) => section.id === navigate.tab)
              ) {
                throw new Error(
                  `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) metric "${field}" ` +
                    `navigates to tab "${navigate.tab}", which is not a section id on this screen. Navigate to an existing section id or remove navigate.tab.`,
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
              `together with a multi-part header.subtitle — subtitleHref only works with the string form. Use a single-field subtitle or remove subtitleHref.`,
          );
        }
        const seenPartFields = new Set<string>();
        for (const part of screen.header.subtitle) {
          const partField = typeof part === "string" ? part : part.field;
          if (seenPartFields.has(partField)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) header.subtitle ` +
                `lists field "${partField}" twice. List each field once.`,
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
              navigateLookups,
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
          validateListActionTargets(
            {
              featureName: feature.name,
              screenId,
              screenType: "projectionDetail",
              screenEntity: undefined,
              where: `Screen "${screenId}" (projectionDetail) section "${sectionLabel}"`,
              screens: feature.screens,
              allWriteHandlerQns,
              ...navigateLookups,
            },
            "emptyState action",
            section.emptyState.action,
          );
        }
        if (isExtensionEditSection(section)) {
          // projectionDetail is read-only (no composed form submit) — an
          // extension that persists through the host's Save button has
          // nothing to save against. Extensions that persist themselves
          // (e.g. notes-history NotesSection, via their own dispatcher
          // writes) are fine.
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
          for (const f of section.fields) {
            const fieldName = normalizeEditField(f).field;
            if (section.fieldDefs[fieldName] === undefined) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (projectionDetail) section "${section.title}" ` +
                  `(writeForm) field "${fieldName}" has no entry in fieldDefs — every rendered field needs ` +
                  `a type declared there. Add the field to fieldDefs.`,
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
      validatePrimaryActionTarget(feature.name, screenId, screen);
      if (screen.actions !== undefined) {
        for (const action of screen.actions) {
          validateActionHasIcon(feature.name, screenId, "projectionDetail", "action", action);
          validateRecordActionRedirect(
            feature,
            screenId,
            "projectionDetail",
            action,
            navigateLookups,
          );
          if (isRowClickAction(action)) {
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
          } else if (action.kind === "clientAction") {
            validateClientActionName(feature.name, screenId, "projectionDetail", "action", action);
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
      validateDashboardRecordBinding(feature.name, screenId, screen);
      validateDashboardActions(feature.name, screenId, screen, allWriteHandlerQns, {
        allScreenQns,
        navTargetShortIds,
        screensByShortId,
        detailForScreens,
      });
      continue;
    }

    if (screen.type === "configEdit") {
      // Validate configEdit layout and fields like actionForm, then verify that
      // every qualified config key is registered and its scope matches the key.
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
              `primitive (fw#2166). Move the section to a projectionDetail screen or remove it.`,
          );
        }
        if (isWriteFormEditSection(section)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) writeForm section ` +
              `"${section.title}" is not supported — writeForm is a projectionDetail-only primitive. Move the section to a projectionDetail screen or remove it.`,
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
      for (const fname of Object.keys(screen.secretKeys ?? {})) {
        if (!fieldNames.has(fname)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) secretKeys names unknown field "${fname}".`,
          );
        }
      }
      // configKeys: every fieldName must have a mapping entry, and every
      // qualified key must exist in the registry.
      for (const fname of fieldNames) {
        const secretQn = screen.secretKeys?.[fname];
        if (secretQn !== undefined) {
          validateConfigEditSecretField(feature.name, screen, fname, secretQn, featureMap);
          continue;
        }
        const qualified = screen.configKeys[fname];
        if (qualified === undefined) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" has ` +
              `no entry in the configKeys map. Every declared field needs a mapping to a ` +
              `qualified config key (\`<feature>:config:<short>\`). Add one to configKeys.`,
          );
        }
        const configKeyDef = configKeyDefsByQn.get(qualified);
        if (configKeyDef === undefined) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" → ` +
              `Config key "${qualified}" is not declared in any feature registry. Typo? ` +
              `Expected format: "<feature>:config:<short>". Known keys: ${
                [...configKeyDefsByQn.keys()].sort().join(", ") || "(none)"
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
        navigateLookups,
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
        navigateLookups,
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
              `with an empty or non-string "field". Set field to a non-empty string.`,
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
              `"${revealField.field}" has an empty or non-string "label". Set label to a non-empty string.`,
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
        rejectInertColumnSortable(feature.name, screenId, "entityList", normalized);
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
      // Validate pagination, sorting, and search at boot so authoring errors
      // fail before runtime debugging of empty or incorrectly sorted lists.
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
        // `sortable: true` is required so the UI never sorts on a column that has
        // no server-side DB index or that the schema deliberately keeps unsortable
        // (audit fields, computed values). `sortable` currently
        // exists only on TextFieldDef; the `in` narrowing also permits other
        // field types without an explicit flag, which is acceptable because
        // Number/Date fields are naturally sortable. Authors can mark them
        // sortable when their field type supports it.
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
      // Screen filters are checked in three layers:
      //   1) The field exists on the entity; a typo would otherwise produce an
      //      empty list instead of a clear boot failure.
      //   2) The field has `filterable: true`, preventing accidental filtering
      //      of audit, computed, or encrypted fields.
      //   3) The operation matches the field type, so lt/gt on text fields
      //      fails at boot instead of causing surprising runtime behavior.
      // Additionally, "in" requires a readonly array.
      if (screen.filter !== undefined) {
        const filterField = screen.filter.field;
        if (!fieldNames.has(filterField)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references unknown ` +
              `field "${filterField}". Known fields: ${[...fieldNames].sort().join(", ")}`,
          );
        }
        if (!isListFilterAllowed(entityDef, filterField, screen.filter)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references field ` +
              `"${filterField}" which is encrypted, personal or secret, so the list handler rejects ` +
              `this filter at runtime. Only op "eq" works on a personal field with find: "exact" or ` +
              `"fuzzy"; otherwise drop the filter or filter on another field.`,
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
              `filter.value to be a readonly array. Pass an array as filter.value.`,
          );
        }
      }
      // Pin rowActions at boot: a navigate target must exist in the same feature
      // and a writeHandler QN must be registered. Typos would otherwise only
      // surface on the first click as "Screen not found" or a 404.
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
            // Entity-targets are exempt: the renderer always
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
          } else if (action.kind === "clientAction") {
            validateClientActionName(feature.name, screenId, "entityList", "rowAction", action);
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
      // toolbarActions, analogous to rowActions: misspelled navigate targets and
      // unregistered writeHandler QNs fail at boot instead of on the first click.
      if (screen.toolbarActions !== undefined) {
        for (const action of screen.toolbarActions) {
          if (action.kind === "navigate") {
            const candidateQn = qualifyEntityName(feature.name, "screen", action.screen);
            if (!allScreenQns.has(candidateQn) && !navTargetShortIds.has(action.screen)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) toolbarAction "${action.id}" ` +
                  `navigate-target "${action.screen}" does not resolve to a registered screen in any feature. Use "<feature>:screen:<id>" of an existing screen.`,
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
            validateRecordActionRedirect(feature, screenId, "entityEdit", action, navigateLookups);
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
              `primitive (fw#2166). Move the section to a projectionDetail screen or remove it.`,
          );
        }
        if (isWriteFormEditSection(section)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) writeForm section ` +
              `"${section.title}" is not supported — writeForm is a projectionDetail-only primitive. Move the section to a projectionDetail screen or remove it.`,
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
          validateEditFieldExtras(feature.name, screenId, entityDef, normalized);
          const fieldWhere = `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) field "${normalized.field}"`;
          validateFieldFormRefs(fieldWhere, normalized, fieldNames);
          validateFillActionTarget(fieldWhere, normalized, entityDef.fields[normalized.field]);
        }
      }
      validateWizardLayout(feature.name, screenId, "entityEdit", screen.layout, featureMap);
      // Header actions reuse RowAction — same shape and same checks as
      // projectionDetail's `actions` above (the loaded record stands in
      // for the row). `rowClick` is rejected outright — entityEdit has no
      // row to click either.
      if (screen.actions !== undefined) {
        for (const action of screen.actions) {
          validateRecordActionRedirect(feature, screenId, "entityEdit", action, navigateLookups);
          if (isRowClickAction(action)) {
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
          } else if (action.kind === "clientAction") {
            validateClientActionName(feature.name, screenId, "entityEdit", "action", action);
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
      if (typeof screen.readOnly === "object" && !fieldNames.has(screen.readOnly.field)) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) readOnly condition field ` +
            `"${screen.readOnly.field}" is not a field of entity "${screen.entity}" ` +
            `(known: ${[...fieldNames].sort().join(", ")}).`,
        );
      }
      if (screen.redirect !== undefined) {
        validateRedirectTarget(feature, screenId, "entityEdit", screen.redirect, navigateLookups);
      }
    }
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

// Extract bare screen IDs (without the `<feature>:screen:` prefix) from
// qualified QNs for app-wide navigate-target resolution (see validateScreens).
// This mirrors the runtime router, which matches bare IDs across features.
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
