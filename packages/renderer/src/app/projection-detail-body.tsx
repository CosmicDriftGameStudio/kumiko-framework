import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import { RenderEdit } from "../components/render-edit.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { Translate } from "../headless/index.ts";
import { useLocale, useTranslation } from "../i18n.tsx";
import { usePageHeaderCompact, usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import { usePrimitives } from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import { useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import type { ErrorNotice } from "./error-reference.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { useNav } from "./nav.tsx";
import {
  type DetailRegionModel,
  deriveDetailRegionPieces,
  renderDetailHeaderContent,
} from "./projection-detail-header-region.tsx";
import {
  renderDetailQueryError,
  renderMissingIdBanner,
  renderRecordNotFound,
} from "./projection-detail-states.tsx";
import { renderProjectionDrawerHost } from "./projection-drawer-host.tsx";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { useReturnHost, useReturnTarget } from "./return-to.tsx";
import { useProjectionDetailActions } from "./use-projection-detail-actions.ts";
import { useProjectionDetailData } from "./use-projection-detail-data.ts";
import { useProjectionDetailLayout } from "./use-projection-detail-layout.ts";
import { useRelatedListTabCounts } from "./use-related-list-tab-counts.ts";

// Projection detail body: read-only single-row inspector over an explicit
// query instead of an entity (see projection-detail-shim.ts for the debt
// doc). Fetches itself via `screen.query` + `idParam` (like
// EntityEditUpdateBody, which derives the query QN from the entity
// convention; here the QN is author-explicit, as with ProjectionListBody).
// Renders through RenderEdit WITH a no-op customSubmit instead of a
// writeCommand: hasEditableSection() hides the save button (every field is
// readOnly), and even a native form submit (Enter keypress) would throw
// against controller.submit() without a submit config if there were no
// customSubmit; the no-op makes that path harmless instead of leaving it to
// chance.
export function ProjectionDetailBody({
  schema,
  screen,
  translate,
  entityId,
}: {
  readonly schema: FeatureSchema;
  // detailFor sits on the ScreenDefinition intersection, not on the
  // projectionDetail variant itself (screen.ts:832) — widen the prop type
  // to keep reading it here instead of re-deriving it from schema.screens.
  readonly screen: ProjectionDetailScreenDefinition & { readonly detailFor?: string };
  readonly translate?: Translate;
  readonly entityId?: string;
}): ReactNode {
  const primitives = usePrimitives();
  const t = useTranslation();
  const locale = useLocale().locale();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompactContext = usePageHeaderCompact();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();
  // Singleton screens ignore whatever id the path happens to carry — the
  // server picks the row from session/context, so forwarding a path id
  // (even a stray/spoofed one) into the query or into extension sections'
  // entityId fallback (resolveExtensionEntityId in render-edit.tsx) would
  // let a client-controlled value leak where none is meant to reach.
  const effectiveEntityId = screen.singleton === true ? undefined : entityId;
  const { activeSection, hasTabs, entity, detailScreen, detailQuery, reloadNonce, reloadDetail } =
    useProjectionDetailData({ screen, Tabs: primitives.Tabs, nav, effectiveEntityId });

  // Header actions render directly via RenderEditActionButton
  // headerActions moved out of RenderEdit's footer — this component owns
  // the failure-surfacing state RenderEdit used to own for them.
  const [actionError, setActionError] = useState<ErrorNotice | null>(null);

  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const host = useReturnHost();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton has no record route to come back to — same as entityEdit.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const drawer = useDrawerAction(schema);
  const { openDrawer } = drawer;
  const { buildSectionActions, headerActions } = useProjectionDetailActions({
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
  });
  const { hasMetrics, headerActionsList, hasHeaderActions, hasHeaderCard, renderedDetailScreen } =
    useProjectionDetailLayout({ screen, headerActions, hasTabs, detailScreen });

  const recordId = detailQuery.data?.["id"];
  const tabCounts = useRelatedListTabCounts({
    sections: hasTabs ? screen.layout.sections : [],
    parentId: effectiveEntityId ?? (typeof recordId === "string" ? recordId : undefined),
  });

  if (effectiveEntityId === undefined && screen.singleton !== true) {
    return renderMissingIdBanner(primitives, screen);
  }
  if (detailQuery.loading && detailQuery.data === null) {
    return <QueryLoadingBanner />;
  }
  if (detailQuery.error && detailQuery.data === null) {
    return renderDetailQueryError(detailQuery.error, effectiveTranslate, detailQuery.refetch);
  }
  // A failed refetch keeps the last good record on screen.
  const refetchErrorBanner = detailQuery.error
    ? renderDetailQueryError(detailQuery.error, effectiveTranslate, detailQuery.refetch)
    : null;
  const record = detailQuery.data;
  if (!record) {
    return renderRecordNotFound({ schema, screen, nav, returnTarget, effectiveTranslate });
  }
  const regionModel: DetailRegionModel = {
    screen,
    record,
    primitives,
    effectiveTranslate,
    locale,
    nav,
    appFeatures,
    userRoles,
    host,
    headerActionsList,
    setActionError,
    actionError,
    pageHeaderSlotAvailable,
    pageHeaderCompactContext,
    hasHeaderActions,
    hasMetrics,
    hasHeaderCard,
    hasTabs,
    tabCounts,
    activeSection,
  };
  const regionPieces = deriveDetailRegionPieces(regionModel);
  const renderHeaderContent = (headerSlot: ReactNode | undefined): ReactNode =>
    renderDetailHeaderContent(regionModel, regionPieces, headerSlot);
  return (
    <>
      {refetchErrorBanner}
      <RenderEdit
        key={entityId}
        refreshToken={reloadNonce}
        screen={renderedDetailScreen}
        entity={entity}
        featureName={schema.featureName}
        initial={record}
        entityId={effectiveEntityId}
        customSubmit={async () => ({ isSuccess: true, validationBlocked: false, data: undefined })}
        onReload={reloadDetail}
        onRelatedListDrawerAction={openDrawer}
        {...(translate !== undefined && { translate })}
        {...(hasTabs && { hideSectionTitles: true })}
        {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
        {...((hasHeaderCard ||
          hasTabs ||
          screen.slots?.header !== undefined ||
          screen.recordTitleField !== undefined) && {
          headerRegion: renderHeaderContent,
        })}
        buildSectionActions={buildSectionActions}
        valueDisplay={screen.valueDisplay ?? "text"}
      />
      {renderProjectionDrawerHost({
        schema,
        translate,
        userRoles,
        drawer,
        refreshRows: reloadDetail,
      })}
    </>
  );
}
