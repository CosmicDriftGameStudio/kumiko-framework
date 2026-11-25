import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { pageHelpButtonOf } from "../components/page-help-button.tsx";
import { RenderEdit } from "../components/render-edit.tsx";
import {
  WriteFormDirtyReporterProvider,
  WriteFormRegistryProvider,
} from "../components/write-form-registry.ts";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { Translate } from "../headless/index.ts";
import { useLocale, useTranslation } from "../i18n.tsx";
import { FlushDrawerBodyProvider } from "../inside-drawer.ts";
import { usePageHeaderCompact, usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import { usePrimitives } from "../primitives.tsx";
import { type DrawerDetailRenderer, useDrawerAction } from "./action-form-body.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import { DrawerDetailScope } from "./drawer-detail-scope.tsx";
import type { ErrorNotice } from "./error-reference.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { useNav } from "./nav.tsx";
import { detailEditLayoutProps } from "./projection-detail-edit-layout.ts";
import { hasFlatDetailHeader } from "./projection-detail-flat-header.ts";
import {
  ProjectionDetailFooterForm,
  useDetailScreenWithoutFooter,
} from "./projection-detail-footer.tsx";
import { hasRecordGuidance } from "./projection-detail-guidance-data.ts";
import {
  type DetailRegionModel,
  deriveDetailRegionPieces,
  renderDetailHeaderContent,
  renderDetailTabStrip,
  renderFlatDetailHeader,
} from "./projection-detail-header-region.tsx";
import { InPlaceActionForm, isInPlaceFormAction } from "./projection-detail-inplace-form.tsx";
import {
  type ProjectionDetailScreenWithTarget,
  renderDetailQueryError,
  renderMissingIdBanner,
  renderRecordNotFound,
} from "./projection-detail-states.tsx";
import { renderProjectionDrawerHost } from "./projection-drawer-host.tsx";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { useReferenceLinkResolver } from "./reference-link.ts";
import { useReturnHost, useReturnTarget } from "./return-to.tsx";
import { useUnsavedInputGuard } from "./unsaved-input-guard.tsx";
import { useProjectionDetailActions } from "./use-projection-detail-actions.ts";
import { useProjectionDetailData } from "./use-projection-detail-data.ts";
import { useProjectionDetailLayout } from "./use-projection-detail-layout.ts";
import { useRelatedListTabCounts } from "./use-related-list-tab-counts.ts";
import { useWriteFormTracking } from "./use-write-form-tracking.ts";

// Detail opened from a row action inside a Drawer: own tab state, own record id.
export const renderDetailInDrawer: DrawerDetailRenderer = ({
  schema,
  screen,
  translate,
  entityId,
  onDirtyChange,
}) => (
  <DrawerDetailScope key={entityId}>
    <ProjectionDetailBody
      schema={schema}
      screen={screen}
      entityId={entityId}
      onDirtyChange={onDirtyChange}
      scrollContentOnly
      {...(translate !== undefined && { translate })}
    />
  </DrawerDetailScope>
);

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
  screen: declaredScreen,
  translate,
  entityId,
  onDirtyChange,
  scrollContentOnly = false,
}: {
  readonly schema: FeatureSchema;
  // detailFor sits on the ScreenDefinition intersection, not on the
  // projectionDetail variant itself (screen.ts:832) — widen the prop type
  // to keep reading it here instead of re-deriving it from schema.screens.
  readonly screen: ProjectionDetailScreenWithTarget;
  readonly translate?: Translate;
  readonly entityId?: string;
  /** Reports whether any writeForm section holds unsent input (a drawer host asks before closing). */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Drawer hosting: only the record content scrolls, the footer form stays pinned below it. */
  readonly scrollContentOnly?: boolean;
}): ReactNode {
  const primitives = usePrimitives();
  const t = useTranslation();
  const locale = useLocale().locale();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompactContext = usePageHeaderCompact();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();
  const { footerSection, screen } = useDetailScreenWithoutFooter(declaredScreen);
  // Singleton screens ignore whatever id the path happens to carry — the
  // server picks the row from session/context, so forwarding a path id
  // (even a stray/spoofed one) into the query or into extension sections'
  // entityId fallback (resolveExtensionEntityId in render-edit.tsx) would
  // let a client-controlled value leak where none is meant to reach.
  const effectiveEntityId = screen.singleton === true ? undefined : entityId;
  const {
    activeSection,
    activeSections,
    visibleSections,
    hasTabs,
    entity,
    detailScreen,
    detailQuery,
    reloadNonce,
    reloadDetail: reloadDetailData,
  } = useProjectionDetailData({ screen, nav, effectiveEntityId });

  // Header actions render directly via RenderEditActionButton
  // headerActions moved out of RenderEdit's footer — this component owns
  // the failure-surfacing state RenderEdit used to own for them.
  const [actionError, setActionError] = useState<ErrorNotice | null>(null);
  // Every successful write of this detail reloads it (footer and header actions, related-list row
  // actions and inline cell edits through reloadHost), so the reload is where a stale failure goes.
  const reloadDetail = useCallback(async () => {
    setActionError(null);
    await reloadDetailData();
  }, [reloadDetailData]);

  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const resolveReference = useReferenceLinkResolver();
  const host = useReturnHost();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton has no record route to come back to — same as entityEdit.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const drawer = useDrawerAction(schema);
  const { openDrawer } = drawer;
  // Writing forms and a form shown in place both ask before the hosting drawer discards them.
  const [writeFormsDirty, setWriteFormsDirty] = useState(false);
  const { writeForms, dirtyWriteForms, reportWriteFormDirty } =
    useWriteFormTracking(setWriteFormsDirty);
  const inPlaceFormGuard = useUnsavedInputGuard(drawer.closeDrawer);
  // The submitted drawer form carried the footer's values, so they are no longer unsent.
  const reloadAfterDrawer = () => {
    if (drawer.drawerAction !== null) writeForms.get(drawer.drawerAction.id)?.rebase();
    return reloadDetail();
  };
  const anyUnsavedInput = writeFormsDirty || inPlaceFormGuard.hasUnsavedInput;
  useEffect(() => {
    onDirtyChange?.(anyUnsavedInput);
  }, [anyUnsavedInput, onDirtyChange]);
  // Esc, back, tab switch and Cancel of that form share one discard question (inPlaceFormGuard).
  const inPlaceForm =
    scrollContentOnly &&
    drawer.drawerAction !== null &&
    drawer.drawerScreen !== undefined &&
    isInPlaceFormAction(drawer.drawerAction, drawer.drawerScreen)
      ? { action: drawer.drawerAction, screen: drawer.drawerScreen }
      : undefined;
  const flatHeader = scrollContentOnly && hasFlatDetailHeader(declaredScreen);
  const { buildSectionActions, buildItemActions, headerActions, footerActions, footerFormButtons } =
    useProjectionDetailActions({
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
      activeTabId: activeSection?.id,
      writeForms,
      dirtyWriteForms,
      footerFormActions: footerSection?.actions,
    });
  const pageHelp = detailPageHelpOf(
    screen,
    visibleSections,
    schema,
    effectiveTranslate,
    appFeatures,
  );
  const { hasMetrics, headerActionsList, hasHeaderActions, hasHeaderCard, renderedDetailScreen } =
    useProjectionDetailLayout({ screen, headerActions, hasTabs, detailScreen, pageHelp });

  const recordId = detailQuery.data?.["id"];
  const tabCounts = useRelatedListTabCounts({
    sections: hasTabs ? visibleSections : [],
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
  const visibleMetrics = screen.metrics?.filter(
    (metric) =>
      metric.visibleWhen === undefined || evalFieldCondition(metric.visibleWhen, { ...record }),
  );
  const regionModel: DetailRegionModel = {
    screen: {
      ...screen,
      ...(visibleMetrics !== undefined && { metrics: visibleMetrics }),
      layout: { ...screen.layout, sections: visibleSections },
    },
    record,
    primitives,
    effectiveTranslate,
    locale,
    nav,
    appFeatures,
    userRoles,
    host,
    headerActionsList,
    ...(pageHelp !== undefined && { pageHelp }),
    setActionError,
    actionError,
    pageHeaderSlotAvailable,
    pageHeaderCompactContext,
    hasHeaderActions,
    hasMetrics: hasMetrics && (visibleMetrics?.length ?? 0) > 0,
    hasHeaderCard,
    hasTabs,
    tabCounts,
    activeSection,
    resolveReference,
    buildItemActions,
    ...(inPlaceForm !== undefined && {
      beforeTabSwitch: inPlaceFormGuard.requestCloseThen,
    }),
  };
  const regionPieces = deriveDetailRegionPieces(regionModel);
  const editLayout = detailEditLayoutProps({
    screen,
    hasTabs,
    activeSections,
    translate: effectiveTranslate,
  });
  const renderHeaderContent = (headerSlot: ReactNode | undefined): ReactNode =>
    renderDetailHeaderContent(regionModel, regionPieces, headerSlot);
  return (
    <WriteFormRegistryProvider value={writeForms}>
      <WriteFormDirtyReporterProvider value={reportWriteFormDirty}>
        {flatHeader && renderFlatDetailHeader(regionModel, regionPieces)}
        {flatHeader && renderDetailTabStrip(regionModel)}
        {inPlaceForm !== undefined && (
          <InPlaceActionForm
            schema={schema}
            action={inPlaceForm.action}
            screen={inPlaceForm.screen}
            initialValues={drawer.drawerInitialValues}
            headingValues={drawer.drawerHeadingValues}
            translate={translate}
            userRoles={userRoles}
            guard={inPlaceFormGuard}
            onSubmitted={() => {
              drawer.closeDrawer();
              void reloadAfterDrawer();
            }}
          />
        )}
        {/* Hidden, not unmounted, while the form is shown: an unsent footer note must survive it. */}
        <PaneWrap
          className={
            scrollContentOnly
              ? `min-h-0 flex-1 overflow-y-auto${inPlaceForm !== undefined ? " hidden" : ""}`
              : undefined
          }
        >
          {refetchErrorBanner}
          <FlushDrawerBodyProvider value={flatHeader}>
            <RenderEdit
              key={entityId}
              refreshToken={reloadNonce}
              screen={renderedDetailScreen}
              entity={entity}
              featureName={schema.featureName}
              initial={record}
              entityId={effectiveEntityId}
              customSubmit={async () => ({
                isSuccess: true,
                validationBlocked: false,
                data: undefined,
              })}
              onReload={reloadDetail}
              onRelatedListDrawerAction={openDrawer}
              {...(translate !== undefined && { translate })}
              {...(hasTabs && activeSection !== undefined && { activeTabId: activeSection.id })}
              {...editLayout}
              {...(!flatHeader &&
                (hasHeaderCard ||
                  hasTabs ||
                  hasRecordGuidance(screen) ||
                  screen.slots?.header !== undefined ||
                  screen.recordTitleField !== undefined) && {
                  headerRegion: renderHeaderContent,
                })}
              {...(footerActions !== undefined &&
                footerActions.length > 0 && { actions: footerActions })}
              buildSectionActions={buildSectionActions}
              valueDisplay={screen.valueDisplay ?? "text"}
            />
          </FlushDrawerBodyProvider>
        </PaneWrap>
        {footerSection !== undefined && (
          <PaneWrap
            className={
              scrollContentOnly
                ? `shrink-0${inPlaceForm !== undefined ? " hidden" : ""}`
                : undefined
            }
          >
            <ProjectionDetailFooterForm
              section={footerSection}
              screenId={declaredScreen.id}
              featureName={schema.featureName}
              record={record}
              translate={effectiveTranslate}
              buttons={footerFormButtons}
              onSubmitted={reloadDetail}
              onActionError={setActionError}
            />
          </PaneWrap>
        )}
        {renderProjectionDrawerHost({
          schema,
          translate,
          userRoles,
          drawer:
            inPlaceForm === undefined
              ? drawer
              : { ...drawer, drawerAction: null, drawerScreen: undefined },
          refreshRows: reloadAfterDrawer,
          renderDetail: renderDetailInDrawer,
        })}
      </WriteFormDirtyReporterProvider>
    </WriteFormRegistryProvider>
  );
}

function detailPageHelpOf(
  screen: ProjectionDetailScreenWithTarget,
  sections: ProjectionDetailScreenWithTarget["layout"]["sections"],
  schema: FeatureSchema,
  translate: Translate,
  appFeatures: readonly FeatureSchema[],
): ReactNode {
  const sectionSources = sections.flatMap((section) =>
    "kind" in section && section.kind === "relatedList"
      ? [
          {
            spec: section.pageHelp,
            defaultEntity: section.entity ?? "",
            scopeTitle: section.title,
          },
        ]
      : [],
  );
  return pageHelpButtonOf([{ spec: screen.pageHelp, defaultEntity: "" }, ...sectionSources], {
    featureName: schema.featureName,
    screenId: screen.id,
    ownEntities: schema.entities,
    translate,
    appFeatures,
  });
}

// A wrapper only where a layout needs it: on the full page the footer's `sticky` must stay
// relative to the page container, so there the children remain direct siblings.
function PaneWrap({
  className,
  children,
}: {
  readonly className: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return className === undefined ? children : <div className={className}>{children}</div>;
}
