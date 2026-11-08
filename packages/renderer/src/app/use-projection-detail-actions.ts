import type { RowAction, RowActionWriteHandler } from "@cosmicdrift/kumiko-framework/ui-types";
import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import { useCallback, useMemo } from "react";
import type { RenderEditAction } from "../components/render-edit.tsx";
import type { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import type { useUserRoles } from "../context/user-roles-context.tsx";
import type { Translate } from "../headless/index.ts";
import type { useDrawerAction } from "./action-form-body.tsx";
import type { useAppFeatures } from "./app-features-context.tsx";
import type { useClientActionRuntime } from "./client-actions.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import type { NavApi, ScreenTarget } from "./nav.tsx";
import type { ProjectionDetailScreenWithTarget } from "./projection-detail-states.tsx";
import { lastSegment } from "./qn.ts";
import {
  navigateToReturnOr,
  navigateWithReturnTo,
  type useReturnHost,
  type useReturnTarget,
} from "./return-to.tsx";
import { buildRecordActions } from "./row-actions.ts";
import { findEditScreenFor } from "./screen-access.ts";
import { findEntityListScreen, navigateAfterRedirect } from "./screen-shared.tsx";
import type { useProjectionDetailData } from "./use-projection-detail-data.ts";

type DetailActionsInput = {
  readonly schema: FeatureSchema;
  readonly screen: ProjectionDetailScreenWithTarget;
  readonly effectiveTranslate: Translate;
  readonly effectiveEntityId: string | undefined;
  readonly nav: NavApi;
  readonly host: ReturnType<typeof useReturnHost>;
  readonly dispatcher: ReturnType<typeof useOptionalDispatcher>;
  readonly clientActions: ReturnType<typeof useClientActionRuntime>;
  readonly appFeatures: ReturnType<typeof useAppFeatures>;
  readonly userRoles: ReturnType<typeof useUserRoles>;
  readonly returnTarget: ReturnType<typeof useReturnTarget> | undefined;
  readonly openDrawer: ReturnType<typeof useDrawerAction>["openDrawer"];
  readonly detailQuery: ReturnType<typeof useProjectionDetailData>["detailQuery"];
  readonly reloadDetail: ReturnType<typeof useProjectionDetailData>["reloadDetail"];
  readonly activeTabId: string | undefined;
};

function isShownOnTab(action: RowAction, activeTabId: string | undefined): boolean {
  return (
    action.showOnTabs === undefined ||
    (activeTabId !== undefined && action.showOnTabs.includes(activeTabId))
  );
}

export function useProjectionDetailActions(input: DetailActionsInput) {
  const {
    schema,
    screen,
    effectiveTranslate,
    effectiveEntityId,
    nav,
    host,
    dispatcher,
    clientActions,
    appFeatures,
    userRoles,
    returnTarget,
    openDrawer,
    detailQuery,
    reloadDetail,
    activeTabId,
  } = input;
  const handleRecordLeft = useCallback(
    (action: RowActionWriteHandler, resultData: unknown, deletedShownRecord: boolean) => {
      const record = detailQuery.data ?? {};
      // Never return onto the just-deleted record.
      const target =
        deletedShownRecord && returnTarget?.entityId === effectiveEntityId
          ? undefined
          : returnTarget;
      if (action.redirect !== undefined) {
        navigateAfterRedirect({
          nav,
          schema,
          appFeatures,
          returnTarget: target,
          redirect: action.redirect,
          resultData,
          record,
        });
        // skip: the redirect already navigated
        return;
      }
      navigateToReturnOr(nav, target, () => {
        const listScreen =
          screen.listScreenId ??
          (screen.detailFor !== undefined
            ? findEntityListScreen(schema, screen.detailFor)?.id
            : undefined);
        if (listScreen !== undefined) nav.navigate({ screenId: lastSegment(listScreen) });
        else void detailQuery.refetch();
      });
    },
    [
      detailQuery.data,
      detailQuery.refetch,
      nav,
      schema,
      appFeatures,
      returnTarget,
      effectiveEntityId,
      screen.listScreenId,
      screen.detailFor,
    ],
  );
  // Default edit action: resolved cross-feature over ALL mounted
  // features, not just this feature's own schema — detailFor itself is
  // resolved cross-feature by the boot-validator (detail-screens.ts), and
  // the motivating case is a projectionDetail whose query belongs to one
  // feature while the entity's entityEdit screen lives in another. Unlike
  // useNavigateToCreateFor this must NOT filter on allowCreate/singleton —
  // those gate create-targets, we're resolving an update-target by a
  // known id.
  const editScreen = useMemo(() => {
    const detailFor = screen.detailFor;
    // skip: no detailFor means there is no edit screen to resolve
    if (detailFor === undefined) return undefined;
    return findEditScreenFor(detailFor, appFeatures, userRoles);
  }, [appFeatures, screen.detailFor, userRoles]);
  const defaultEditAction = useMemo((): RenderEditAction | undefined => {
    // skip: no edit screen for this entity, so no default edit action
    if (editScreen === undefined) return undefined;
    // editScreen.id is registry-qualified ("feature:screen:contact-edit");
    // nav.navigate expects the short form (see useNavigateToCreateFor).
    const targetScreenId = lastSegment(editScreen.id);
    return {
      id: "edit",
      label: effectiveTranslate("kumiko.actions.edit"),
      icon: resolveActionIcon("edit"),
      onPress: () => {
        const target: ScreenTarget = {
          screenId: targetScreenId,
          ...(effectiveEntityId !== undefined && { entityId: effectiveEntityId }),
        };
        navigateWithReturnTo(nav, target, host);
      },
    };
  }, [editScreen, effectiveTranslate, nav, effectiveEntityId, host]);

  // a navigate-screen action targeting an entityEdit screen for the
  // SAME entity this projectionDetail shows (screen.detailFor) defaults its
  // entityId to the shown record's own id — without this fallback the target
  // opens an empty create-form instead of the shown record, silently.
  // Searched cross-feature, consistent with editScreen above.
  const sameEntityScreenId = useCallback(
    (targetScreen: string): string | undefined => {
      const record = detailQuery.data ?? {};
      const targetIsEntityEditSameEntity =
        screen.detailFor !== undefined &&
        appFeatures.some((feature) =>
          feature.screens.some(
            (s) =>
              s.type === "entityEdit" &&
              s.entity === screen.detailFor &&
              lastSegment(s.id) === targetScreen,
          ),
        );
      return targetIsEntityEditSameEntity ? String(record["id"] ?? "") : undefined;
    },
    [detailQuery.data, screen.detailFor, appFeatures],
  );
  const buildSectionActions = useCallback(
    (actions: readonly RowAction[]): readonly RenderEditAction[] | undefined =>
      buildRecordActions({
        actions,
        record: detailQuery.data ?? {},
        translate: effectiveTranslate,
        nav,
        host,
        dispatcher,
        openDrawer,
        onWriteSuccess: reloadDetail,
        onRecordLeft: handleRecordLeft,
        sameEntityScreenId,
        clientActions,
      }),
    [
      detailQuery.data,
      reloadDetail,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      clientActions,
      openDrawer,
      handleRecordLeft,
      sameEntityScreenId,
    ],
  );
  const buildItemActions = useCallback(
    (
      actions: readonly RowAction[],
      item: Readonly<Record<string, unknown>>,
    ): readonly RenderEditAction[] | undefined => {
      const shownRecordId = effectiveEntityId ?? stringId(detailQuery.data?.["id"]);
      return buildRecordActions({
        actions: omitActionsDefaultingToShownRecordId(actions, shownRecordId),
        record: item,
        translate: effectiveTranslate,
        nav,
        host,
        dispatcher,
        openDrawer,
        onWriteSuccess: reloadDetail,
        onRecordLeft: handleRecordLeft,
        sameEntityScreenId,
        clientActions,
        defaultWritePayloadId: shownRecordId,
      });
    },
    [
      detailQuery.data,
      effectiveEntityId,
      reloadDetail,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      clientActions,
      openDrawer,
      handleRecordLeft,
      sameEntityScreenId,
    ],
  );
  const footerIds = screen.footerActions;
  const recordActions = useMemo((): readonly RenderEditAction[] | undefined => {
    const declaredHasEdit = screen.actions?.some((a) => a.id === "edit") === true;
    const resolved = buildRecordActions({
      actions: (screen.actions ?? []).filter((a) => isShownOnTab(a, activeTabId)),
      record: detailQuery.data ?? {},
      translate: effectiveTranslate,
      nav,
      host,
      dispatcher,
      openDrawer,
      onWriteSuccess: reloadDetail,
      onRecordLeft: handleRecordLeft,
      sameEntityScreenId,
      clientActions,
    });
    // skip: a declared or unavailable edit action leaves the resolved list untouched
    if (defaultEditAction === undefined || declaredHasEdit) return resolved;
    return [defaultEditAction, ...(resolved ?? [])];
  }, [
    screen.actions,
    activeTabId,
    defaultEditAction,
    effectiveTranslate,
    nav,
    host,
    dispatcher,
    clientActions,
    detailQuery.data,
    reloadDetail,
    openDrawer,
    handleRecordLeft,
    sameEntityScreenId,
  ]);
  // footerActions render in RenderEdit's pinned footer, so the header bar must not repeat them.
  const headerActions = useMemo(
    () =>
      footerIds === undefined
        ? recordActions
        : recordActions?.filter((a) => !footerIds.includes(a.id)),
    [recordActions, footerIds],
  );
  const footerActions = useMemo(
    () =>
      footerIds === undefined
        ? undefined
        : recordActions
            ?.filter((a) => footerIds.includes(a.id))
            .map((a) =>
              screen.actions?.find((declared) => declared.id === a.id)?.align === "start"
                ? { ...a, align: "start" as const, pinnedOnPhone: true as const }
                : { ...a, pinnedOnPhone: true as const },
            ),
    [recordActions, footerIds, screen.actions],
  );
  return { buildSectionActions, buildItemActions, headerActions, footerActions };
}

// Without a shown record id, a payload-less write or client action would fall back to the guidance item's own id (a step key, not a record id).
export function omitActionsDefaultingToShownRecordId(
  actions: readonly RowAction[],
  shownRecordId: string | undefined,
): readonly RowAction[] {
  if (shownRecordId !== undefined) return actions;
  return actions.filter(
    (action) =>
      !(
        (action.kind === undefined ||
          action.kind === "writeHandler" ||
          action.kind === "clientAction") &&
        action.payload === undefined
      ),
  );
}

function stringId(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
