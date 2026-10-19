import type {
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigScope,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  ActionFormRedirect,
  ActionFormScreenDefinition,
  ActionFormSuccessLink,
  ConfigEditScreenDefinition,
  DashboardPanelVisibility,
  DashboardScreenDefinition,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  MetricNavigate,
  MetricSpec,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RecordHeaderSubtitlePart,
  RowAction,
  RowActionDrawer,
  RowActionNavigate,
  RowActionWriteHandler,
  ScreenDefinition,
  ToolbarAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  isRecordLocked,
  isWriteFormEditSection,
  metricField,
  parseRefTarget,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  Command,
  Dispatcher,
  DispatcherError,
  FormSnapshot,
  FormValues,
  ListRowViewModel,
  SubmitResult,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import {
  applyFormatSpec,
  buildOptionLabels,
  computeRelatedListSectionViewModel,
  fieldLabelKey,
  fieldOptionLabelKey,
  isSafeHref,
} from "@cosmicdrift/kumiko-headless";
import { resolveActionIcon } from "@cosmicdrift/kumiko-types/action-icon";
import { TENANT_CURRENCY_CONFIG_KEY } from "@cosmicdrift/kumiko-types/fields";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  QueryOptionLabel,
  resolveOptionsQueryPayload,
} from "../components/query-options-select.tsx";
import { extractCreatedId, extractIdField } from "../components/reference-create-dialog.tsx";
import {
  RenderEdit,
  type RenderEditAction,
  type RenderEditControls,
  resolveRecordTitle,
} from "../components/render-edit.tsx";
import { RenderList } from "../components/render-list.tsx";
import { useDispatcher, useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useIsEmbeddedScreen } from "../context/embedded-screen-context.tsx";
import { useUserRoles } from "../context/user-roles-context.tsx";
import { useOptionalCurrentUser } from "../current-user.tsx";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "../hooks/reference-limits.ts";
import { type ListSort, PAGE_SIZE_OPTIONS, useListUrlState } from "../hooks/use-list-url-state.ts";
import { type UseQueryResult, useQuery } from "../hooks/use-query.ts";
import { referenceLookupSource } from "../hooks/use-reference-lookup.ts";
import { useLocale, useOptionalTimeZone, useTranslation } from "../i18n.tsx";
import { InsideDrawerProvider, useInsideDrawer } from "../inside-drawer.ts";
import {
  PageHeaderSlotAvailableProvider,
  usePageHeaderCompact,
  usePageHeaderSlotAvailable,
} from "../page-header-slot.ts";
import {
  type DataTableDateRangeFacet,
  type DataTableFacet,
  type DataTableRowAction,
  type StatusTone,
  statusToneForOptionTone,
  statusToneForValue,
  usePrimitives,
} from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import {
  actionFormSubmittableFields,
  synthesizeActionFormEntity,
  synthesizeActionFormScreen,
} from "./action-form-shim.ts";
import {
  ActionFormLoadStatus,
  ActionFormSuccessBanner,
  type ActionFormSuccessState,
  isSecretFormField,
  type ResolvedSuccessLink,
  resolveActionFormRecordId,
  useActionFormLoad,
} from "./action-form-support.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import {
  buildConfigEditSchema,
  synthesizeConfigEditEntity,
  synthesizeConfigEditScreen,
} from "./config-edit-shim.ts";
import { useCustomScreenComponent } from "./custom-screens.tsx";
import { useDashboardBody } from "./dashboard-body.tsx";
import { applyEditPrefill } from "./edit-prefill.ts";
import { EntityListExpandedRow } from "./entity-list-expanded-row.tsx";
import { FacetCountBridges, type FacetCountQuery } from "./facet-count-bridge.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { buildFormSchema } from "./form-schema.ts";
import { HeaderActionsBar } from "./header-actions-bar.tsx";
import { hiddenRequiredFieldsFilled, layoutEditFields, layoutFieldNames } from "./layout-fields.ts";
import { isListNarrowed, useListEmptyContent } from "./list-empty-content.ts";
import {
  buildDateRangePayload,
  buildEntityFilterFacets,
  buildFacetCountRequests,
  buildFilterFacets,
  buildFilterPayload,
  clampDateRange,
  mergeReferenceFacetOptions,
  normalizeDefaultFilters,
  type ResolvedFacetSpec,
  readDateRange,
  resolveDateRangeFacets,
  resolveProjectionFacetSpecs,
} from "./list-facets.ts";
import { type NavApi, type ScreenTarget, useInitialValuesHandoff, useNav } from "./nav.tsx";
import {
  synthesizeProjectionDetailEntity,
  synthesizeProjectionDetailScreen,
} from "./projection-detail-shim.ts";
import { synthesizeProjectionEntity, synthesizeProjectionScreen } from "./projection-list-shim.ts";
import { lastSegment, toKebab } from "./qn.ts";
import { featureNameFromQualifiedScreenId, qualifyScreenId } from "./qualify-screen-id.ts";
import { QueryErrorBanner, QueryLoadingBanner } from "./query-state-banners.tsx";
import { ReferenceFacetBridges, type ReferenceFacetOption } from "./reference-facet-bridge.tsx";
import {
  navigateToReturn,
  navigateToReturnOr,
  navigateWithReturnTo,
  type ReturnHost,
  ReturnHostProvider,
  useReturnHost,
  useReturnTarget,
} from "./return-to.tsx";
import {
  buildClientActionRowAction,
  buildDefaultEditRowAction,
  buildDrawerRowAction,
  buildProjectionRowActions,
  buildProjectionToolbarActions,
  buildRecordActions,
  evalRowExtractor,
  findRowClickAction,
  navigateActionSearchParams,
  refetchAfterWrite,
  runDrawerRowAction,
  runProjectionRowNavigate,
} from "./row-actions.ts";
import { findEditScreenFor, navigateTargetAllows, screenAccessAllows } from "./screen-access.ts";
import { SecretMintBody } from "./secret-mint-body.tsx";
import { SecretsEditBody } from "./secrets-edit-body.tsx";
import { useEmbeddedScreen } from "./use-embedded-screen.ts";
import { evalVisibleWhenAfterShown } from "./visible-when.ts";
import { dispatcherErrorText, WriteFailedError } from "./write-failed-error.ts";

// KumikoScreen picks up a ScreenDefinition from the schema by qn and
// routes it to the right renderer based on `screen.type`. Command
// qualification (`<feature>:write:<entity>:create` etc.) happens here
// so the renderers stay command-agnostic — consistent with how the
// server-side dispatcher resolves QNs from ScreenDefinition + feature.
//
// The discriminator is `screen.type`, not a component-registry lookup
// with feature-provided overrides — that's M4's r.uiComponent feature.

export type KumikoScreenProps = {
  readonly schema: FeatureSchema;
  readonly qn: string;
  readonly translate?: Translate;
  // Optional entity-id / row-id. Meaningful for entityEdit screens — when
  // set, the edit screen loads the existing record via the detail query and
  // submits an update command (`write:<entity>:update`) instead of a create.
  // Also required for projectionDetail screens (which row to fetch — no
  // create mode exists there). For entityList/custom screens it's ignored.
  readonly entityId?: string;
  // Fires when the user clicks a row on an entityList screen. The
  // second argument is the screen's entity name, threaded through so
  // the caller's handler can navigate to `<edit screen for this
  // entity>/{row.id}` without re-deriving it. Default wiring in
  // createKumikoApp does exactly that; override to open a drawer,
  // inline-expand, etc.
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  // Copy-Link-Action auf entityEdit-Update-Screens (Issue #912). Bereits
  // vollständig gebunden (URL-Bau + Clipboard) — createKumikoApp/RoutedScreen
  // liefert die Default-Impl, dieses platform-neutrale Package baut selbst
  // keine URLs/Clipboard-Calls (guard-renderer-boundaries). Nur in
  // update-mode sichtbar (entityId muss gesetzt sein).
  readonly onCopyLink?: () => Promise<void> | void;
};

export { qualifyScreenId };

/** Mirrors qualifyScreenId for nav QNs (registry form `<feature>:nav:<short-id>`).
 *  Callers building QNs (e.g. the WorkspaceShell resolver) should use this instead of string-concat, so a QN-schema change only touches one place. */
export function qualifyNavId(featureName: string, navId: string): string {
  return `${featureName}:nav:${navId}`;
}

export { screenAccessAllows };

export function KumikoScreen({
  schema,
  qn,
  translate,
  entityId,
  onRowClick,
  onCopyLink,
}: KumikoScreenProps): ReactNode {
  const userRoles = useUserRoles();
  const outerHost = useReturnHost();
  const screen = useMemo(
    () =>
      schema.screens.find(
        (s: ScreenDefinition) => qualifyScreenId(schema.featureName, s.id) === qn,
      ),
    [schema.featureName, schema.screens, qn],
  );
  // Computed before the early returns below — hooks must run unconditionally.
  const ownHost = useMemo(
    (): ReturnHost => ({
      screenId: screen !== undefined ? lastSegment(screen.id) : "",
      ...(entityId !== undefined && { entityId }),
    }),
    [screen, entityId],
  );

  if (!screen) {
    return <ScreenMissingState screenQn={qn} />;
  }

  if (!screenAccessAllows(screen.access, userRoles)) {
    return <ScreenAccessDeniedBanner screenQn={qn} testId="kumiko-screen-access-denied" />;
  }

  const screenBody = renderScreenBody({
    schema,
    screen,
    translate,
    entityId,
    onRowClick,
    onCopyLink,
  });
  // Gate every entry (incl. direct URL): the body element is only mounted once the condition holds.
  const body =
    screen.visibleWhen !== undefined ? (
      <ScreenVisibilityGate
        featureName={schema.featureName}
        visibleWhen={screen.visibleWhen}
        fallback={screen.fallback}
        translate={translate}
      >
        {screenBody}
      </ScreenVisibilityGate>
    ) : (
      screenBody
    );
  // An embedded screen (e.g. a dashboard panel) keeps its parent's host and
  // must not portal its page header into the shell that hosts the outer screen.
  if (outerHost !== undefined) {
    return <PageHeaderSlotAvailableProvider value={false}>{body}</PageHeaderSlotAvailableProvider>;
  }
  return <ReturnHostProvider value={ownHost}>{body}</ReturnHostProvider>;
}

function ScreenVisibilityGate({
  featureName,
  visibleWhen,
  fallback,
  translate,
  children,
}: {
  readonly featureName: string;
  readonly visibleWhen: DashboardPanelVisibility;
  readonly fallback: string | undefined;
  readonly translate?: Translate;
  readonly children: ReactNode;
}): ReactNode {
  const { Banner } = usePrimitives();
  const result = useQuery<Readonly<Record<string, unknown>>>(visibleWhen.query, {}, { live: true });
  const wasShown = useRef(false);
  const verdict = evalVisibleWhenAfterShown(visibleWhen, result, wasShown.current);
  useEffect(() => {
    if (verdict === "visible") wasShown.current = true;
  }, [verdict]);
  if (verdict === "visible") return children;
  if (verdict === "loading") {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (fallback !== undefined) {
    return <FallbackScreen featureName={featureName} fallback={fallback} translate={translate} />;
  }
  return (
    <>
      <LockedScreenHeader />
      <ScreenUnavailableBanner />
    </>
  );
}

// The route still names the locked screen; its breadcrumb must not label what stands in for it.
// With a stand-in the header is labelled with that screen instead, none if it has no title.
function LockedScreenHeader({ standInScreenId }: { readonly standInScreenId?: string }): ReactNode {
  const { PageHeader } = usePrimitives();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  if (PageHeader === undefined || !pageHeaderSlotAvailable) return null;
  return standInScreenId !== undefined ? (
    <PageHeader hideBreadcrumb breadcrumbScreenId={standInScreenId} />
  ) : (
    <PageHeader hideBreadcrumb />
  );
}

function ScreenMissingHomeButton({
  homeScreenId,
  testId,
}: {
  readonly homeScreenId: string;
  readonly testId: string;
}): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  return (
    <Button
      variant="secondary"
      onClick={() => nav.navigate({ screenId: homeScreenId })}
      testId={testId}
    >
      {t("kumiko.screen-missing.home")}
    </Button>
  );
}

/** Empty state for a screen QN that is not in the schema (feature disabled for
 *  the tenant, stale link, miswired screen). The QN only goes to the console. */
export function ScreenMissingState({
  screenQn,
  homeScreenId,
  testId = "kumiko-screen-not-found",
}: {
  readonly screenQn: string;
  readonly homeScreenId?: string;
  readonly testId?: string;
}): ReactNode {
  const { Card, Text } = usePrimitives();
  const t = useTranslation();
  useEffect(() => {
    console.warn(
      `[kumiko] screen "${screenQn}" is not in the schema (feature disabled, stale link or miswired screen).`,
    );
  }, [screenQn]);
  return (
    <Card
      options={{ padded: true }}
      slots={{
        title: <Text testId={`${testId}-title`}>{t("kumiko.screen-missing.title")}</Text>,
        subtitle: <Text variant="muted">{t("kumiko.screen-missing.hint")}</Text>,
      }}
      testId={testId}
    >
      {homeScreenId !== undefined ? (
        <ScreenMissingHomeButton homeScreenId={homeScreenId} testId={`${testId}-home`} />
      ) : null}
    </Card>
  );
}

function ScreenAccessDeniedBanner({
  screenQn,
  testId,
}: {
  readonly screenQn: string;
  readonly testId: string;
}): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  useEffect(() => {
    console.warn(`[kumiko] access to screen "${screenQn}" denied for the current roles.`);
  }, [screenQn]);
  return (
    <Banner padded variant="error" testId={testId}>
      {t("kumiko.screen-access-denied.title")}
    </Banner>
  );
}

function ScreenUnavailableBanner(): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  return (
    <Banner padded variant="info" testId="kumiko-screen-unavailable">
      {t("kumiko.screen.unavailable")}
    </Banner>
  );
}

function FallbackScreen({
  featureName,
  fallback,
  translate,
}: {
  readonly featureName: string;
  readonly fallback: string;
  readonly translate?: Translate;
}): ReactNode {
  const target = useEmbeddedScreen(featureName, fallback);
  // Also undefined when the user lacks access to the fallback screen, which is
  // not a framework error.
  if (target === undefined) {
    return (
      <>
        <LockedScreenHeader />
        <ScreenUnavailableBanner />
      </>
    );
  }
  return (
    <>
      <LockedScreenHeader standInScreenId={lastSegment(target.qn)} />
      <KumikoScreen schema={target.schema} qn={target.qn} translate={translate} />
    </>
  );
}

function renderScreenBody({
  schema,
  screen,
  translate,
  entityId,
  onRowClick,
  onCopyLink,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ScreenDefinition;
  readonly translate?: Translate;
  readonly entityId?: string;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
  readonly onCopyLink?: () => Promise<void> | void;
}): ReactNode {
  switch (screen.type) {
    case "entityEdit":
      return (
        <EntityEditScreen
          schema={schema}
          screen={screen}
          translate={translate}
          {...(entityId !== undefined && { entityId })}
          {...(onCopyLink !== undefined && { onCopyLink })}
        />
      );
    case "entityList":
      return (
        <EntityListScreen
          schema={schema}
          screen={screen}
          translate={translate}
          {...(onRowClick !== undefined && { onRowClick })}
        />
      );
    case "projectionList":
      return (
        <ProjectionListBody
          schema={schema}
          screen={screen}
          translate={translate}
          {...(onRowClick !== undefined && { onRowClick })}
        />
      );
    case "projectionDetail":
      return (
        // key on the record identifier alone (never the active tab, see
        // ProjectionDetailBody's own hideSectionTitles/tab handling) forces
        // a full remount when navigating from one record to the next —
        // without it React keeps the RenderEdit form controller alive and
        // the screen briefly shows the PREVIOUS record's fields (fw#2518).
        <ProjectionDetailBody
          key={entityId ?? "no-entity"}
          schema={schema}
          screen={screen}
          translate={translate}
          {...(entityId !== undefined && { entityId })}
        />
      );
    case "dashboard":
      return (
        <DashboardScreenBody
          featureName={schema.featureName}
          screen={screen}
          translate={translate}
        />
      );
    case "actionForm":
      return (
        <ActionFormBody
          schema={schema}
          screen={screen}
          translate={translate}
          {...(entityId !== undefined && { entityId })}
        />
      );
    case "secretMint":
      return <SecretMintBody schema={schema} screen={screen} translate={translate} />;
    case "configEdit":
      // Keyed by screen id: the form state is seeded once at mount, so switching
      // between two settings screens must remount instead of carrying the
      // previous screen's (empty) field state over.
      return (
        <ConfigEditBody key={screen.id} schema={schema} screen={screen} translate={translate} />
      );
    case "secretsEdit":
      return <SecretsEditBody key={screen.id} screen={screen} translate={translate} />;
    case "custom":
      return <CustomScreenBody screenId={screen.id} featureName={schema.featureName} />;
  }
}

// Injection-Body für dashboard-Screens: die Panel-Implementierung (StatCard,
// Charts) ist plattform-spezifisch und kommt aus dem DashboardBody-Context
// (renderer-web registriert die Web-Variante in createKumikoApp).
function DashboardScreenBody({
  featureName,
  screen,
  translate,
}: {
  readonly featureName: string;
  readonly screen: DashboardScreenDefinition;
  readonly translate?: Translate;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const Body = useDashboardBody();
  if (Body === undefined) {
    return (
      <Banner padded variant="info" testId="kumiko-screen-dashboard-placeholder">
        Dashboard screen <Text variant="code">{screen.id}</Text> — kein Dashboard-Body registriert
        (createKumikoApp aus <Text variant="code">kumiko-renderer-web</Text> wired ihn automatisch).
      </Banner>
    );
  }
  return (
    <Body
      featureName={featureName}
      screen={screen}
      {...(translate !== undefined && { translate })}
    />
  );
}

// Lookup-Body für custom-screens: schaut die Component aus dem
// CustomScreens-Context (gefüttert von clientFeatures.components in
// createKumikoApp). Wenn weder Provider gemounted noch screenId
// registriert ist, fällt es auf einen error-Banner zurück statt leer zu
// rendern — der Screen ist per URL erreichbar sobald das Server-Feature
// gemountet ist, unabhängig davon ob ein Client-Plugin existiert
// (kumiko-framework#2025).
function CustomScreenBody({
  screenId,
  featureName,
}: {
  readonly screenId: string;
  readonly featureName: string;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const Component = useCustomScreenComponent(screenId);
  if (Component === undefined) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-custom-placeholder">
        Custom screen <Text variant="code">{screenId}</Text> (Feature{" "}
        <Text variant="code">{featureName}</Text>) hat keine Component in{" "}
        <Text variant="code">clientFeatures.components</Text> — das Web-Client-Plugin des Features
        (siehe <Text variant="code">{featureName}/web/client-plugin.tsx</Text>) fehlt in{" "}
        <Text variant="code">clientFeatures</Text>.
      </Banner>
    );
  }
  return <Component />;
}

// ---- entity-edit ----

// Derives `<feature>:write:<entity>:<verb>` from the screen's entity
// and the schema's feature name. Matches qualifyEntityName / toKebab in
// packages/framework/src/engine/qualified-name.ts so camelCase entity
// ids (e.g. driverModel) resolve to server QNs (driver-model:create).
function entityWriteCommand(
  featureName: string,
  entity: string,
  verb: "create" | "update" | "delete",
): string {
  return `${toKebab(featureName)}:write:${toKebab(entity)}:${verb}`;
}

// Default "success → zurück zur Liste"-Navigation. Findet den ersten
// entityList-Screen für die Entity und navigiert dahin. Wird von
// Create/Update/Delete genauso verwendet — alle drei haben "fertig
// editiert, raus hier" als sinnvolles Default-Verhalten.
function findEntityListScreen(
  schema: FeatureSchema,
  entityName: string,
): ScreenDefinition | undefined {
  return schema.screens.find(
    (s: ScreenDefinition) => s.type === "entityList" && s.entity === entityName,
  );
}

// Unknown or deleted record id: a localized empty state with a way back
// instead of a bare error banner. Composed from shared primitives so web and
// native render it alike.
function RecordNotFoundState({
  translate,
  onBack,
}: {
  readonly translate: Translate;
  readonly onBack?: () => void;
}): ReactNode {
  const { Card, Text, Button } = usePrimitives();
  return (
    <Card options={{ padded: true }} testId="kumiko-screen-record-missing">
      <Text testId="kumiko-screen-record-missing-title">
        {translate("kumiko.record.not-found.title")}
      </Text>
      <Text variant="muted">{translate("kumiko.record.not-found.hint")}</Text>
      {onBack !== undefined && (
        <Button variant="secondary" onClick={onBack} testId="kumiko-screen-record-missing-back">
          {translate("kumiko.record.not-found.back")}
        </Button>
      )}
    </Card>
  );
}

function useNavigateToListAfter(schema: FeatureSchema, entityName: string): () => void {
  const nav = useNav();
  return useCallback(() => {
    const list = findEntityListScreen(schema, entityName);
    if (!list) return;
    // schema.screens.id ist QN-form (registry-stamped); nav.navigate
    // erwartet Short-Form. Sonst landet die URL doppelt-qualifiziert.
    nav.navigate({ screenId: lastSegment(list.id) });
  }, [nav, schema, entityName]);
}

// Default "+ Neu"-Navigation für die List-Toolbar: findet den ersten
// entityEdit-Screen ohne entityId-Anhang und navigiert dorthin.
// Returns undefined wenn kein Edit-Screen registriert ist — RenderList
// rendert dann keinen + Neu Button.
//
// Schema-Screens kommen mit qualifizierten ids ("publicstatus:screen:
// component-edit") aus der Registry; lastSegment strippt den Prefix
// für nav.navigate (siehe ./qn.ts für Doku).
function pageSizeOptionsFor(currentLimit: number): readonly number[] {
  return PAGE_SIZE_OPTIONS.includes(currentLimit)
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, currentLimit].sort((a, b) => a - b);
}

function useNavigateToCreateFor(
  schema: FeatureSchema,
  entityName: string,
  createScreen?: string,
  createUnavailable?: boolean,
): (() => void) | undefined {
  const nav = useNav();
  const host = useReturnHost();
  const editScreenId = useMemo(() => {
    if (createScreen !== undefined) return createScreen;
    // The role may not open the declared create target; falling back to the
    // entity's edit form would bypass the flow the app prescribes (e.g. a wizard).
    if (createUnavailable === true) return undefined;
    // allowCreate:false = update-only Edit-Screen (Create läuft über einen
    // Lifecycle-Write) — der zählt nicht als „+ Neu"-Ziel. singleton:true
    // öffnet ohne entityId den vorhandenen Record (EntityEditSingletonBody)
    // statt eines leeren Create-Forms — zählt aus demselben Grund nicht.
    const edit = schema.screens.find(
      (s: ScreenDefinition) =>
        s.type === "entityEdit" &&
        s.entity === entityName &&
        s.allowCreate !== false &&
        s.singleton !== true,
    );
    return edit !== undefined ? lastSegment(edit.id) : undefined;
  }, [schema.screens, entityName, createScreen, createUnavailable]);
  const navigate = useCallback(() => {
    if (editScreenId !== undefined) navigateWithReturnTo(nav, { screenId: editScreenId }, host);
  }, [nav, editScreenId, host]);
  return editScreenId !== undefined ? navigate : undefined;
}

// `defaultCurrency` is entityEdit-only — it enables the `{amount, currency}`
// write shape (fw#1923); config-edit's plain-number contract needs bare `0`.
// `moneyCurrencyOverrides` (fw#2933) replaces `defaultCurrency` per field name
// — used for a `money` field that declares `currency: { kind: "tenant" }`, so
// its empty initial value carries the tenant's own currency instead of the
// entity-wide default.
function versionOf(record: Readonly<Record<string, unknown>>): number {
  const version = record["version"];
  return typeof version === "number" ? version : 1;
}

export function buildInitialValues(
  fields: Readonly<Record<string, unknown>>,
  defaultCurrency?: string,
  moneyCurrencyOverrides?: Readonly<Record<string, string>>,
): FormValues {
  const out: FormValues = {};
  for (const [name, def] of Object.entries(fields)) {
    const type = propertyOf(def, "type");
    const defaultValue = propertyOf(def, "default");
    if (defaultValue !== undefined) {
      out[name] = defaultValue;
      continue;
    }
    // An untouched optional number must not persist as a deliberate 0.
    if (type === "number" && propertyOf(def, "required") !== true) {
      out[name] = undefined;
      continue;
    }
    if (type === "embedded" && propertyOf(def, "multiple") === true) {
      out[name] = [];
      continue;
    }
    if (type === "money") {
      const currency = moneyCurrencyOverrides?.[name] ?? defaultCurrency;
      if (currency !== undefined) {
        out[name] = { amount: 0, currency };
        continue;
      }
    }
    out[name] =
      type === "boolean"
        ? false
        : type === "number" || type === "money"
          ? 0
          : type === "multiSelect"
            ? []
            : "";
  }
  return out;
}

// A `money` field opts a currently-empty value into the tenant-settings
// bundle's per-tenant currency (fw#2933) via `currency: { kind: "tenant" }`
// on its FieldDefinition. Read structurally — renderer only depends on the
// client-safe FieldDefinition subset, not the concrete MoneyFieldDef/
// MoneyCurrencySource types, same idiom as the other field-shape narrowings
// in this file (PrefillFieldShape etc.).
export function tenantCurrencyMoneyFieldNames(
  fields: Readonly<Record<string, unknown>>,
): readonly string[] {
  const names: string[] = [];
  for (const [name, def] of Object.entries(fields)) {
    if (
      propertyOf(def, "type") === "money" &&
      propertyOf(propertyOf(def, "currency"), "kind") === "tenant"
    ) {
      names.push(name);
    }
  }
  return names;
}

type TenantConfigValuesResponse = Readonly<
  Record<string, { readonly value: string | number | boolean | undefined }>
>;

type TenantCurrencyResolution =
  | { readonly status: "not-needed" }
  | { readonly status: "loading" }
  | { readonly status: "unresolved" }
  | { readonly status: "ready"; readonly currency: string };

// Resolves what a tenant-declared money field's currency should be, from the
// same `config:query:values` query ConfigEditBody already uses. Never falls
// back to "EUR" while the query is genuinely still in flight (fw#2933) — a
// screen with no tenant-declared money field, or a query that errored or
// returned no value for the key, resolves immediately instead of blocking.
function resolveTenantCurrency(
  fieldNames: readonly string[],
  query: UseQueryResult<TenantConfigValuesResponse>,
  fallback: string | undefined,
): TenantCurrencyResolution {
  if (fieldNames.length === 0) return { status: "not-needed" };
  if (query.error) {
    return fallback === undefined
      ? { status: "unresolved" }
      : { status: "ready", currency: fallback };
  }
  if (query.data === null) return { status: "loading" };
  const raw = query.data[TENANT_CURRENCY_CONFIG_KEY]?.value;
  if (typeof raw === "string" && raw !== "") return { status: "ready", currency: raw };
  return fallback === undefined
    ? { status: "unresolved" }
    : { status: "ready", currency: fallback };
}

const HEADER_CARD_DEFAULT_WIDTH = "4xl" as const;

// Shared by the update payload shape and the server-error path prefix so both can't drift.
const UPDATE_CHANGES_KEY = "changes";

// A money field naming a fixed ISO code (`currency: { kind: "literal", code }`,
// fw#2839) resolves with no query at all. Read structurally, same idiom as
// tenantCurrencyMoneyFieldNames above.
export function literalCurrencyOverrides(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, def] of Object.entries(fields)) {
    const currency = propertyOf(def, "currency");
    const code = propertyOf(currency, "code");
    if (
      propertyOf(def, "type") === "money" &&
      propertyOf(currency, "kind") === "literal" &&
      typeof code === "string"
    ) {
      out[name] = code;
    }
  }
  return out;
}

// Per-field currency for the money fields that declare their own source: a
// literal code resolves synchronously (fw#2839), a `{ kind: "tenant" }` field
// needs the tenant-settings config query and makes the caller hold the form
// until it lands (fw#2933) — seeding the fallback meanwhile would render, and
// on a fast click submit, the wrong currency. Callers pass the tenant field
// names themselves because an edit form only needs the fetch for fields the
// record has no stored value for.
export function useMoneyCurrencyOverrides(
  fields: Readonly<Record<string, unknown>>,
  tenantFieldNames: readonly string[],
  // `undefined` = no safe last resort (entity-less forms): an unresolvable
  // tenant currency is reported via `unresolved` instead of guessing a code.
  fallback: string | undefined,
): {
  readonly overrides: Readonly<Record<string, string>> | undefined;
  readonly loading: boolean;
  readonly unresolved: boolean;
} {
  const query = useQuery<TenantConfigValuesResponse>(
    "config:query:values",
    { keys: [TENANT_CURRENCY_CONFIG_KEY] },
    { enabled: tenantFieldNames.length > 0 },
  );
  const resolution = resolveTenantCurrency(tenantFieldNames, query, fallback);
  const resolvedTenantCurrency = resolution.status === "ready" ? resolution.currency : undefined;
  const overrides = useMemo(() => {
    const out: Record<string, string> = { ...literalCurrencyOverrides(fields) };
    if (resolvedTenantCurrency !== undefined) {
      for (const name of tenantFieldNames) out[name] = resolvedTenantCurrency;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }, [fields, tenantFieldNames, resolvedTenantCurrency]);
  return {
    overrides,
    loading: resolution.status === "loading",
    unresolved: resolution.status === "unresolved",
  };
}

function multiSelectOptionValues(shape: {
  readonly options?: readonly (string | { readonly value: string })[];
}): ReadonlySet<string> | undefined {
  if (shape.options === undefined || shape.options.length === 0) return undefined;
  return new Set(shape.options.map((o) => (typeof o === "string" ? o : o.value)));
}

type MoneyValue = { readonly amount: number; readonly currency: string };

// The currency now comes from a user-controlled URL param and reaches
// `Intl.NumberFormat`, which throws a RangeError on a malformed code — reject
// it here instead of crashing the form render.
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

function isMoneyValue(value: unknown): value is MoneyValue {
  if (typeof value !== "object" || value === null) return false;
  const amount = propertyOf(value, "amount");
  const currency = propertyOf(value, "currency");
  return (
    typeof amount === "number" &&
    Number.isFinite(amount) &&
    typeof currency === "string" &&
    CURRENCY_CODE_PATTERN.test(currency)
  );
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatSummaryValue(value: unknown, locale: string): string {
  if (isMoneyValue(value)) {
    return new Intl.NumberFormat(locale, { style: "currency", currency: value.currency }).format(
      value.amount,
    );
  }
  if (typeof value === "number") return applyFormatSpec({ format: "number", locale }, value);
  if (typeof value === "string" && ISO_DATE_PATTERN.test(value)) {
    return applyFormatSpec({ format: "date", locale }, value);
  }
  return value === null || value === undefined ? "" : String(value);
}

function formatSummaryParams(
  prefill: Readonly<Record<string, unknown>> | undefined,
  locale: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(prefill ?? {}).map(([name, value]) => [name, formatSummaryValue(value, locale)]),
  );
}

// Placeholders of `successMessage`: formatted submitted values, with a
// reference field resolved to the chosen record's label. A lookup that fails or
// misses the row (the lookup list is capped) falls back to the raw id.
async function resolveSuccessMessageParams(
  screen: ActionFormScreenDefinition,
  featureName: string,
  values: Readonly<Record<string, unknown>>,
  dispatcher: Dispatcher,
  locale: string,
): Promise<Record<string, string>> {
  const params = formatSummaryParams(values, locale);
  await Promise.all(
    Object.entries(screen.fields).map(async ([name, def]) => {
      const raw = values[name];
      if (def.type !== "reference" || typeof raw !== "string" || raw === "") return;
      const target = parseRefTarget(def.entity, featureName);
      const { queryQn, labelKey } = referenceLookupSource(
        target.featureName,
        target.entityName,
        def.labelField ?? "id",
      );
      const lookup = await dispatcher.query<{ rows: ReadonlyArray<Record<string, unknown>> }>(
        queryQn,
        { limit: REFERENCE_LIST_LOOKUP_LIMIT },
      );
      if (!lookup.isSuccess) return;
      const row = lookup.data.rows.find((candidate) => candidate["id"] === raw);
      const label = row?.[labelKey];
      if (label !== undefined && label !== null) params[name] = String(label);
    }),
  );
  return params;
}

function resolveActionFormSummary(
  summary: ActionFormScreenDefinition["summary"],
  prefill: Readonly<Record<string, unknown>> | undefined,
  translate: Translate,
  locale: string,
): { readonly title: string; readonly subtitle?: string } | undefined {
  if (summary === undefined) return undefined;
  const params = formatSummaryParams(prefill, locale);
  return {
    title: translate(summary.title, params),
    ...(summary.subtitle !== undefined && { subtitle: translate(summary.subtitle, params) }),
  };
}

function parseJsonOrRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function warnPrefillParam(message: string): void {
  // biome-ignore lint/suspicious/noConsole: dev-warning for an authoring error
  console.warn(`[kumiko] ${message}`);
}

// An actionForm has no entity and thus no defaultCurrency, so a bare-number
// prefill would stay a number the handler's zod schema rejects (fw#2763).
function coerceMoneyValue(
  raw: unknown,
  fieldName: string,
  defaultCurrency?: string,
): MoneyValue | number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = typeof raw === "string" ? parseJsonOrRaw(raw) : raw;
  if (value === null) return undefined;
  if (isMoneyValue(value)) return { amount: value.amount, currency: value.currency.toUpperCase() };
  if (typeof value === "object") {
    warnPrefillParam(
      `money field "${fieldName}" got an object without a usable {amount, currency} shape — the prefill is ignored.`,
    );
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") return undefined;
  const amount = Number(typeof value === "number" ? value : raw);
  if (!Number.isFinite(amount)) return undefined;
  if (defaultCurrency !== undefined) return { amount, currency: defaultCurrency };
  warnPrefillParam(
    `money field "${fieldName}" was prefilled with a bare number and no currency is available — pass {"amount":<number>,"currency":"<ISO code>"} as the param value, otherwise the handler's schema rejects the submit.`,
  );
  return amount;
}

type EmbeddedCellShape = {
  readonly type?: string;
  readonly options?: readonly string[];
  readonly scale?: number;
};

// Mirrors isRepresentableAtScale in the framework's schema-builder, which the
// renderer cannot import (server engine). Keep the tolerance identical so a
// prefilled cell never passes here and fails the handler's schema.
function isRepresentableAtScale(value: number, scale: number): boolean {
  const scaled = value * 10 ** scale;
  const tolerance = Math.abs(scaled) * 8 * Number.EPSILON + Number.EPSILON;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

// Server schema (`z.iso.datetime()`) accepts only a `Z` suffix, while
// Temporal.Instant.from also takes numeric offsets.
function isUtcIsoInstant(value: string): boolean {
  if (!value.endsWith("Z")) return false;
  try {
    Temporal.Instant.from(value);
    return true;
  } catch {
    return false;
  }
}

const EMBEDDED_LIST_PREFILL_ROW_LIMIT = 500;

// The server schema (`z.string().date()`) rejects calendar-invalid days like 2020-02-31.
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}

function isDecimalWithinSafeRange(value: number, scale: number | undefined): boolean {
  return scale === undefined || Math.abs(value) <= Number.MAX_SAFE_INTEGER / 10 ** scale;
}

function coerceEmbeddedCell(value: unknown, cell: EmbeddedCellShape): unknown {
  switch (cell.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "decimal":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        (cell.scale === undefined ||
          (isRepresentableAtScale(value, cell.scale) &&
            isDecimalWithinSafeRange(value, cell.scale)))
        ? value
        : undefined;
    case "date":
      return typeof value === "string" && isValidIsoDate(value) ? value : undefined;
    case "timestamp":
      return typeof value === "string" && isUtcIsoInstant(value) ? value : undefined;
    case "money":
      // Row cells are signed minor units; the currency lives on the head, so a
      // top-level `{amount, currency}` in major units would land 100x off.
      return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "select":
      return typeof value === "string" && (cell.options ?? []).includes(value) ? value : undefined;
    default:
      return typeof value === "string" ? value : undefined;
  }
}

// A partially coerced list is the hazard the prefill exists to avoid: the
// handler replaces the list whole, so half a list overwrites the rest.
function coerceEmbeddedListRows(
  raw: string,
  fieldName: string,
  schema: Readonly<Record<string, EmbeddedCellShape>>,
  maxItems?: number,
): readonly Readonly<Record<string, unknown>>[] | undefined {
  const parsed = parseJsonOrRaw(raw);
  if (!Array.isArray(parsed)) {
    warnPrefillParam(
      `embedded-list field "${fieldName}" was prefilled with something that is not a JSON array — the prefill is ignored.`,
    );
    return undefined;
  }
  if (parsed.length > (maxItems ?? EMBEDDED_LIST_PREFILL_ROW_LIMIT)) {
    warnPrefillParam(
      `embedded-list field "${fieldName}" was prefilled with ${parsed.length} rows, more than it accepts — the prefill is ignored.`,
    );
    return undefined;
  }
  const rows: Readonly<Record<string, unknown>>[] = [];
  for (const candidate of parsed) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      warnPrefillParam(
        `embedded-list field "${fieldName}" was prefilled with a row that is not an object — the prefill is ignored.`,
      );
      return undefined;
    }
    const cellEntries: [string, unknown][] = [];
    for (const [cellName, cell] of Object.entries(schema)) {
      const cellValue = propertyOf(candidate, cellName);
      if (cellValue === undefined || cellValue === null) continue;
      const coerced = coerceEmbeddedCell(cellValue, cell);
      if (coerced === undefined) {
        warnPrefillParam(
          `embedded-list field "${fieldName}" was prefilled with a cell "${cellName}" the sub-schema rejects — the prefill is ignored.`,
        );
        return undefined;
      }
      cellEntries.push([cellName, coerced]);
    }
    rows.push(Object.fromEntries(cellEntries));
  }
  return rows;
}

type PrefillFieldShape = {
  readonly type?: string;
  readonly sensitive?: boolean;
  readonly format?: string;
  readonly options?: readonly (string | { readonly value: string })[];
  readonly multiple?: boolean;
  readonly schema?: Readonly<Record<string, EmbeddedCellShape>>;
  readonly maxItems?: number;
};

export type InitialValueSources = {
  readonly searchParams: Readonly<Record<string, string>>;
  // Only these URL query keys may prefill — the target screen's
  // `urlPrefillFields` from buildAppSchema. Absent means none: a crafted link
  // must not seed fields no declared navigate `params` names.
  readonly urlPrefillFields: readonly string[] | undefined;
  readonly renderableFields?: ReadonlySet<string>;
  readonly defaultCurrency?: string;
  // Per-field override of `defaultCurrency` for money fields declaring
  // `currency: { kind: "tenant" }` (fw#2933) — see buildInitialValues.
  readonly moneyCurrencyOverrides?: Readonly<Record<string, string>>;
  // Drawer-kind row actions (fw#2710) prefill from the clicked row's
  // already-typed values; wins over every other source.
  readonly drawerOverrides?: Readonly<Record<string, unknown>>;
  // useNavigateWithInitialValues — in-app only, never in the URL, so it
  // bypasses urlPrefillFields; string values get the URL coercion.
  readonly handoffValues?: Readonly<Record<string, unknown>>;
};

function coercePrefillString(
  raw: string,
  name: string,
  shape: PrefillFieldShape,
  fallback: unknown,
  defaultCurrency: string | undefined,
  moneyCurrencyOverrides: Readonly<Record<string, string>> | undefined,
): unknown {
  if (shape.type === "number") {
    if (raw.trim() === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (shape.type === "money") {
    const coerced = coerceMoneyValue(raw, name, moneyCurrencyOverrides?.[name] ?? defaultCurrency);
    return coerced === undefined ? fallback : coerced;
  }
  if (shape.type === "boolean") return raw === "true";
  if (shape.type === "multiSelect") {
    // Row-action navigate stringifies arrays via String(arr) → "a,b" (or
    // JSON when the navigate helper JSON.stringifies). Try JSON first
    // (even without a "[" prefix), then comma-split; filter against
    // field.options when present so unknown values never reach the form.
    const optionValues = multiSelectOptionValues(shape);
    const splitComma = (): string[] =>
      raw === ""
        ? []
        : raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    let values: string[];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        values = parsed.map((v) => String(v));
      } else if (typeof parsed === "string") {
        values = [parsed];
      } else {
        values = splitComma();
      }
    } catch {
      values = splitComma();
    }
    return optionValues !== undefined ? values.filter((v) => optionValues.has(v)) : values;
  }
  if (shape.type === "embedded" && shape.multiple === true) {
    return coerceEmbeddedListRows(raw, name, shape.schema ?? {}, shape.maxItems) ?? fallback;
  }
  return raw;
}

export function mergeSearchParamsIntoInitial(
  fields: Readonly<Record<string, unknown>>,
  sources: InitialValueSources,
): Record<string, unknown> {
  const {
    searchParams,
    renderableFields,
    defaultCurrency,
    moneyCurrencyOverrides,
    drawerOverrides,
    handoffValues,
  } = sources;
  const urlPrefillFields = new Set(sources.urlPrefillFields ?? []);
  const defaults = buildInitialValues(fields, defaultCurrency, moneyCurrencyOverrides);
  const merged: Record<string, unknown> = { ...defaults };
  for (const [name, fieldDef] of Object.entries(fields)) {
    if (renderableFields !== undefined && !renderableFields.has(name)) continue;
    const shape = fieldDef as PrefillFieldShape;
    // Neither gate is lifted by an allowlist entry or a handoff.
    if (shape.sensitive === true) continue;
    if (shape.format === "password") continue;
    // An `undefined` override (row-extractor key whose row lacks the field)
    // must not wipe the field default.
    if (
      drawerOverrides !== undefined &&
      Object.hasOwn(drawerOverrides, name) &&
      drawerOverrides[name] !== undefined
    ) {
      merged[name] = drawerOverrides[name];
      continue;
    }
    const handedOff =
      handoffValues !== undefined && Object.hasOwn(handoffValues, name)
        ? handoffValues[name]
        : undefined;
    if (handedOff !== undefined) {
      merged[name] =
        typeof handedOff === "string"
          ? coercePrefillString(
              handedOff,
              name,
              shape,
              defaults[name],
              defaultCurrency,
              moneyCurrencyOverrides,
            )
          : handedOff;
      continue;
    }
    if (!urlPrefillFields.has(name)) continue;
    const raw = searchParams[name];
    if (raw === undefined) continue;
    merged[name] = coercePrefillString(
      raw,
      name,
      shape,
      defaults[name],
      defaultCurrency,
      moneyCurrencyOverrides,
    );
  }
  return merged;
}

function EntityEditScreen({
  schema,
  screen,
  translate,
  entityId,
  onCopyLink,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly translate?: Translate;
  readonly entityId?: string;
  readonly onCopyLink?: () => Promise<void> | void;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const entity = schema.entities[screen.entity];
  if (!entity) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-entity-missing">
        Entity <Text variant="code">{screen.entity}</Text> referenced by screen{" "}
        <Text variant="code">{screen.id}</Text> not registered in the schema.
      </Banner>
    );
  }
  // Split into create-body / update-body so the update-only hooks
  // (useQuery(detail)) don't fire in create mode, and vice versa.
  // Same shape as EntityListScreen.
  if (entityId !== undefined) {
    return (
      <EntityEditUpdateBody
        schema={schema}
        screen={screen}
        entity={entity}
        entityId={entityId}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
      />
    );
  }
  if (screen.singleton === true) {
    return (
      <EntityEditSingletonBody
        schema={schema}
        screen={screen}
        entity={entity}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
      />
    );
  }
  return (
    <EntityEditCreateOrDisabled
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
    />
  );
}

function EntityEditCreateBody({
  schema,
  screen,
  entity,
  translate,
  onSaved,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  // Singleton screens (kumiko-screen#1944) run without a wrapping
  // entityList screen, so `navigateToList` below is a silent no-op there —
  // without this callback, a successful create left the form stuck showing
  // the just-submitted values, and a second submit created a duplicate
  // record. Wired by EntityEditSingletonBody to re-run its list(limit:1)
  // query, which flips the branch to EntityEditUpdateBody once it sees the
  // new row.
  readonly onSaved?: () => void;
}): ReactNode {
  const { Banner } = usePrimitives();
  const nav = useNav();
  const handoffValues = useInitialValuesHandoff(screen.id);
  const appFeatures = useAppFeatures();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton stays on its own screen after saving (onSaved/refetch) —
  // returnTo would fight that.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const entityDefaultCurrency = entity.defaultCurrency ?? "EUR";
  // A money field declaring `currency: { kind: "tenant" }` (fw#2933) resolves
  // its empty-value currency from the tenant-settings config key instead of
  // entityDefaultCurrency — `enabled` keeps the query a no-op for entities
  // without any such field.
  const tenantCurrencyFieldNames = useMemo(
    () => tenantCurrencyMoneyFieldNames(entity.fields),
    [entity.fields],
  );
  const { overrides: moneyCurrencyOverrides, loading: currencyLoading } = useMoneyCurrencyOverrides(
    entity.fields,
    tenantCurrencyFieldNames,
    entityDefaultCurrency,
  );
  const currentUser = useOptionalCurrentUser();
  const fallbackTimeZone = useOptionalTimeZone();
  const initial = useMemo(
    () =>
      applyEditPrefill(
        mergeSearchParamsIntoInitial(entity.fields, {
          searchParams: nav.searchParams,
          urlPrefillFields: screen.urlPrefillFields,
          renderableFields: layoutFieldNames(screen),
          defaultCurrency: entityDefaultCurrency,
          ...(moneyCurrencyOverrides !== undefined && { moneyCurrencyOverrides }),
          ...(handoffValues !== undefined && { handoffValues }),
        }),
        layoutEditFields(screen),
        { now: new Date(), fallbackTimeZone, user: currentUser },
      ),
    [
      entity.fields,
      nav.searchParams,
      screen,
      entityDefaultCurrency,
      moneyCurrencyOverrides,
      handoffValues,
      currentUser,
      fallbackTimeZone,
    ],
  );
  const formSchema = useMemo(() => buildFormSchema(entity, screen, "create"), [entity, screen]);
  const writeCommand = entityWriteCommand(schema.featureName, screen.entity, "create");
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const handleCancel = useCallback(
    () => navigateToReturnOr(nav, returnTarget, navigateToList),
    [nav, returnTarget, navigateToList],
  );
  // Create's write-handler success payload doesn't flatly expose a parent FK
  // (`{ kind, id, data, … }`), so an object-form redirect's `idFrom` falls
  // back to the values just submitted to the handler.
  const controlsRef = useRef<RenderEditControls<FormValues> | null>(null);
  const handleControlsReady = useCallback((controls: RenderEditControls<FormValues>) => {
    controlsRef.current = controls;
  }, []);
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      const redirect = screen.redirect;
      if (redirect !== undefined) {
        if (returnToWinsOverRedirect(returnTarget, redirect, schema, appFeatures)) {
          navigateToReturn(nav, returnTarget);
        } else if (typeof redirect === "string") {
          // String form unchanged: always carries the newly created
          // record's own id, regardless of the target screen's type. The
          // object form resolves like actionForm's — a child record's own id
          // is useless for a parent-detail redirect.
          const entityId = extractCreatedId(result.data);
          nav.navigate({
            screenId: lastSegment(redirect),
            ...(entityId !== undefined && { entityId }),
          });
        } else {
          navigateToRedirectTarget(
            nav,
            resolveRedirectTarget(
              redirect,
              result.data,
              schema,
              appFeatures,
              controlsRef.current?.getValues(),
            ),
          );
        }
      } else {
        navigateToReturnOr(nav, returnTarget, navigateToList);
        onSaved?.();
      }
    },
    [nav, screen.redirect, schema, appFeatures, navigateToList, onSaved, returnTarget],
  );
  // Never seed a tenant-declared money field with entityDefaultCurrency while
  // its real tenant currency is still in flight (fw#2933) — wait instead.
  if (currencyLoading) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  // Deliberately no `actions` prop here: `screen.actions` targets an
  // EXISTING record (publish/archive/duplicate and friends), which the
  // create branch has none of yet — see EntityEditUpdateForm for the
  // wired-up counterpart.
  return (
    <RenderEdit
      screen={screen}
      entity={entity}
      featureName={schema.featureName}
      initial={initial}
      schema={formSchema}
      writeCommand={writeCommand}
      onSubmit={handleSubmitted}
      onControlsReady={handleControlsReady}
      onCancel={handleCancel}
      {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
      {...(translate !== undefined && { translate })}
    />
  );
}

// Update body: loads the existing record via `<feature>:query:<entity>:detail`,
// then mounts a form pre-filled with the server values and dispatches
// `<feature>:write:<entity>:update` on submit. `buildPayload` shapes the
// snapshot into Kumiko's update-event envelope `{ id, version, changes }`.
function EntityEditUpdateBody({
  schema,
  screen,
  entity,
  entityId,
  translate,
  onCopyLink,
  autoReloadOnSave,
  onDeleted,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly entityId: string;
  readonly translate?: Translate;
  readonly onCopyLink?: () => Promise<void> | void;
  // Singleton screens (kumiko-screen#1944): `navigateToList` below is a
  // no-op there (no wrapping entityList screen), so a successful update
  // left the form holding the now-stale `recordVersion` it captured at
  // mount — the next submit hit a version conflict. Set by
  // EntityEditSingletonBody to re-fetch this body's own detail query after
  // a successful save, remounting the form (via the version-keyed `key`
  // below) with the fresh version.
  readonly autoReloadOnSave?: boolean;
  // Wired by EntityEditSingletonBody to re-run its list(limit:1) query
  // after a successful delete, so the branch flips back to the create form
  // instead of the update form continuing to display the deleted record.
  readonly onDeleted?: () => void;
}): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const detailQn = `${toKebab(schema.featureName)}:query:${toKebab(screen.entity)}:detail`;
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(detailQn, { id: entityId });
  const nav = useNav();
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const returnTargetParam = useReturnTarget(screen.id);
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;

  if (detailQuery.loading && detailQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (detailQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(detailQuery.error, effectiveTranslate)}
      </Banner>
    );
  }
  const record = detailQuery.data;
  if (!record) {
    const onBack =
      returnTarget !== undefined || findEntityListScreen(schema, screen.entity) !== undefined
        ? () => navigateToReturnOr(nav, returnTarget, navigateToList)
        : undefined;
    return (
      <RecordNotFoundState
        translate={effectiveTranslate}
        {...(onBack !== undefined && { onBack })}
      />
    );
  }
  // Record-version als React-key: bei "Neu laden" refetched detail,
  // liefert neue version, und das Form remountet komplett. Ohne den
  // Key-Wechsel bliebe der useForm-Controller lifetime-scoped auf
  // der ursprünglichen version sitzen — der buildPayload würde
  // weiter die stale version stampen und der Konflikt-Recovery wäre
  // kaputt.
  const recordKey = versionOf(record);
  return (
    <EntityEditUpdateForm
      key={`${entityId}:${recordKey}`}
      schema={schema}
      screen={screen}
      entity={entity}
      entityId={entityId}
      record={record}
      onReload={detailQuery.refetch}
      {...(translate !== undefined && { translate })}
      {...(onCopyLink !== undefined && { onCopyLink })}
      {...(autoReloadOnSave === true && { onSaved: () => void detailQuery.refetch() })}
      {...(onDeleted !== undefined && { onDeleted })}
    />
  );
}

function EntityEditUpdateForm({
  schema,
  screen,
  entity,
  entityId,
  record,
  onReload,
  translate,
  onCopyLink,
  onSaved,
  onDeleted,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly entityId: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly onReload: () => Promise<void> | void;
  readonly translate?: Translate;
  readonly onCopyLink?: () => Promise<void> | void;
  // See EntityEditUpdateBody's autoReloadOnSave/onDeleted docs — both are
  // no-ops unless the caller (singleton screens) wires them.
  readonly onSaved?: () => void;
  readonly onDeleted?: () => void;
}): ReactNode {
  const { Banner } = usePrimitives();
  // Seed the form with the server values for the entity's declared
  // fields; anything else (id, tenant_id, created_at…) stays out of
  // the form and lives in the closure. The record's `version` is
  // captured once and stamped into every update payload — if a
  // concurrent writer bumps it, the server returns a version-conflict
  // error and the user reloads.
  const recordVersion = versionOf(record);
  const entityDefaultCurrency = entity.defaultCurrency ?? "EUR";
  // A money field declaring `currency: { kind: "tenant" }` (fw#2933) resolves
  // its empty-value currency from the tenant-settings config key instead of
  // entityDefaultCurrency — `enabled` keeps the query a no-op for entities
  // without any such field. A record's own stored value (below) always wins
  // over this, regardless of the declaration.
  //
  // Only fields the record itself has no value for need the fetch at all —
  // an already-set tenant-declared field keeps its own stored currency and
  // must never block the form on this query.
  const tenantCurrencyFieldNames = useMemo(
    () =>
      tenantCurrencyMoneyFieldNames(entity.fields).filter(
        (name) => record[name] === null || record[name] === undefined,
      ),
    [entity.fields, record],
  );
  const { overrides: moneyCurrencyOverrides, loading: currencyLoading } = useMoneyCurrencyOverrides(
    entity.fields,
    tenantCurrencyFieldNames,
    entityDefaultCurrency,
  );
  const initial = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(entity.fields)) {
      out[name] =
        record[name] ??
        buildInitialValues(
          { [name]: entity.fields[name] },
          entityDefaultCurrency,
          moneyCurrencyOverrides,
        )[name];
    }
    return out;
  }, [entity.fields, entityDefaultCurrency, moneyCurrencyOverrides, record]);

  const formSchema = useMemo(
    () => buildFormSchema(entity, screen, "update", initial),
    [entity, screen, initial],
  );

  // Extension-Werte (z.B. customFields-jsonb) an extension-sections geben,
  // damit sie beim Edit den Bestand zeigen statt write-only zu sein.
  const extensionInitialValues = useMemo((): Readonly<Record<string, unknown>> | undefined => {
    const cf = record["customFields"];
    return isPlainObject(cf) ? cf : undefined;
  }, [record]);

  const writeCommand = entityWriteCommand(schema.featureName, screen.entity, "update");
  const deleteCommand = entityWriteCommand(schema.featureName, screen.entity, "delete");
  const buildPayload = useMemo(
    () =>
      (snap: { readonly changes: Readonly<Record<string, unknown>> }): unknown => ({
        id: entityId,
        version: recordVersion,
        [UPDATE_CHANGES_KEY]: snap.changes,
      }),
    [entityId, recordVersion],
  );

  const [formDirty, setFormDirty] = useState(false);
  const nav = useNav();
  const appFeatures = useAppFeatures();
  const dispatcher = useDispatcher();
  const clientActions = useClientActionRuntime();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const navigateToList = useNavigateToListAfter(schema, screen.entity);
  const userRoles = useUserRoles();
  const host = useReturnHost();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton stays on its own screen after saving (onSaved/refetch) —
  // returnTo would fight that.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  // Header action buttons (fw entityEdit-actions) — same shape/dispatch
  // pattern as ProjectionDetailBody.headerActions above (the edited record
  // stands in for the "row"), minus the cross-feature defaultEditAction
  // lookup that doesn't apply here (this screen already IS the edit form).
  const handleRecordLeft = useCallback(
    (action: RowActionWriteHandler, resultData: unknown, deletedShownRecord: boolean) => {
      // Never return onto the just-deleted record.
      const target =
        deletedShownRecord && returnTarget?.entityId === entityId ? undefined : returnTarget;
      if (deletedShownRecord) onDeleted?.();
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
        return;
      }
      navigateToReturnOr(nav, target, () => {
        if (findEntityListScreen(schema, screen.entity) !== undefined) navigateToList();
        else if (onDeleted === undefined) void onReload();
      });
    },
    [
      nav,
      schema,
      appFeatures,
      returnTarget,
      record,
      entityId,
      navigateToList,
      onDeleted,
      onReload,
      screen.entity,
    ],
  );
  const sameEntityScreenId = useCallback(
    (targetScreen: string): string | undefined =>
      isEntityEditScreenOfOtherEntity(screen.entity, targetScreen, schema, appFeatures)
        ? undefined
        : entityId,
    [screen.entity, schema, appFeatures, entityId],
  );
  const buildSectionActions = useCallback(
    (actions: readonly RowAction[]): readonly RenderEditAction[] | undefined =>
      buildRecordActions({
        actions,
        record,
        translate: effectiveTranslate,
        nav,
        host,
        dispatcher,
        openDrawer,
        onWriteSuccess: onReload,
        onRecordLeft: handleRecordLeft,
        sameEntityScreenId,
        clientActions,
        defaultWritePayloadId: entityId,
        ...(formDirty && {
          discardChanges: {
            confirm: effectiveTranslate("kumiko.form.unsavedChangesActionConfirm"),
            confirmLabel: effectiveTranslate("kumiko.form.unsavedChangesActionConfirmLabel"),
          },
        }),
      }),
    [
      formDirty,
      record,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      openDrawer,
      onReload,
      handleRecordLeft,
      sameEntityScreenId,
      clientActions,
      entityId,
    ],
  );
  const headerActions = useMemo(
    (): readonly RenderEditAction[] | undefined =>
      buildSectionActions((screen.actions ?? []).filter((a) => a.placement !== "menu")),
    [buildSectionActions, screen.actions],
  );
  const headerMenuActions = useMemo(
    (): readonly RenderEditAction[] | undefined =>
      buildSectionActions((screen.actions ?? []).filter((a) => a.placement === "menu")),
    [buildSectionActions, screen.actions],
  );
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>) => {
      if (!result.isSuccess) return;
      const redirect = screen.redirect;
      if (redirect !== undefined) {
        // The update handler's success payload usually reports only this
        // record's own id (event-store-executor-write.ts), so a parent FK
        // named by `idFrom` falls back to the already-loaded `record`.
        navigateAfterRedirect({
          nav,
          schema,
          appFeatures,
          returnTarget,
          redirect,
          resultData: result.data,
          record: overlayUpdatedProjection(record, result.data),
        });
      } else {
        navigateToReturnOr(nav, returnTarget, navigateToList);
        onSaved?.();
      }
    },
    [nav, screen.redirect, schema, appFeatures, record, navigateToList, onSaved, returnTarget],
  );
  const handleCancel = useCallback(
    () => navigateToReturnOr(nav, returnTarget, navigateToList),
    [nav, returnTarget, navigateToList],
  );
  const handleDelete = useCallback(async () => {
    const res = await dispatcher.write(deleteCommand, { id: entityId });
    if (!res.isSuccess) return res.error;
    // Never return onto the just-deleted record.
    const target = returnTarget?.entityId !== entityId ? returnTarget : undefined;
    navigateToReturnOr(nav, target, navigateToList);
    onDeleted?.();
    return undefined;
  }, [dispatcher, deleteCommand, entityId, navigateToList, onDeleted, returnTarget, nav]);

  // Never seed a tenant-declared money field with entityDefaultCurrency while
  // its real tenant currency is still in flight (fw#2933) — wait instead. A
  // stored (non-empty) value is unaffected — it never reaches this branch's
  // fallback because `initial` above already prefers `record[name]`.
  if (currencyLoading) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }

  // Evaluated against the stored record only, so typing in a form can never
  // flip the screen between editable and view.
  // Either condition shows the view: the server rejects saves of a locked record
  // whatever the screen says, so a screen condition can only add read-only, never lift it.
  // A record without the lock field counts as locked (isRecordLocked), matching the server.
  const viewMode =
    (screen.readOnly !== undefined && evalFieldCondition(screen.readOnly, record)) ||
    isRecordLocked(entity.lockedWhen, record);

  return (
    <>
      <RenderEdit
        screen={screen}
        entity={entity}
        featureName={schema.featureName}
        initial={initial}
        {...(viewMode && { viewMode: true })}
        // Real route id for the extension section (set-value UI): the update
        // form deliberately keeps `id` out of the form values, so the section
        // needs it explicitly — otherwise it renders in create mode.
        entityId={entityId}
        // Stored customFields for the extension section, so editing shows the
        // persisted values instead of behaving write-only.
        extensionInitialValues={extensionInitialValues}
        schema={formSchema}
        writeCommand={writeCommand}
        payloadMode="changes"
        buildPayload={buildPayload}
        serverFieldPathPrefix={`${UPDATE_CHANGES_KEY}.`}
        onSubmit={handleSubmitted}
        onDirtyChange={setFormDirty}
        // allowDelete:false marks an entity without a CRUD delete (history is
        // kept) — without this gate the button dispatched against an
        // unregistered `<entity>:delete` handler.
        {...(screen.allowDelete !== false && !viewMode && { onDelete: handleDelete })}
        onCancel={handleCancel}
        onReload={() => void onReload()}
        {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
        {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
        {...(headerActions !== undefined && { actions: headerActions })}
        {...(headerMenuActions !== undefined && { menuActions: headerMenuActions })}
        buildSectionActions={buildSectionActions}
      />
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerInitialValues !== undefined && { drawerInitialValues })}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void onReload();
        }}
      />
    </>
  );
}

// Singleton entities (`singleton: true`, exactly one record per tenant):
// EntityEditScreen reaches here only without an entityId. Resolve the
// existing record via list(limit:1) before deciding create vs update —
// otherwise every visit without an id would create another record.
function EntityEditSingletonBody({
  schema,
  screen,
  entity,
  translate,
  onCopyLink,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  readonly onCopyLink?: () => Promise<void> | void;
}): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const listQn = entityQueryCommand(schema.featureName, screen.entity, "list");
  const listQuery = useQuery<PagedRows>(listQn, { limit: 1 });

  if (listQuery.loading && listQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (listQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(listQuery.error, effectiveTranslate)}
      </Banner>
    );
  }
  const rawExistingId = listQuery.data?.rows[0]?.["id"];
  const existingId = typeof rawExistingId === "string" ? rawExistingId : undefined;
  if (existingId !== undefined) {
    return (
      <EntityEditUpdateBody
        schema={schema}
        screen={screen}
        entity={entity}
        entityId={existingId}
        {...(translate !== undefined && { translate })}
        {...(onCopyLink !== undefined && { onCopyLink })}
        autoReloadOnSave
        onDeleted={() => void listQuery.refetch()}
      />
    );
  }
  return (
    <EntityEditCreateOrDisabled
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
      onSaved={() => void listQuery.refetch()}
    />
  );
}

// Shared no-entityId tail for both the plain create path and the
// singleton path's empty-table fallback: `allowCreate: false` blocks
// both the same way, since a create submit there would hit an
// unregistered `<entity>:create` handler.
function EntityEditCreateOrDisabled({
  schema,
  screen,
  entity,
  translate,
  onSaved,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  readonly onSaved?: () => void;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  if (screen.allowCreate === false) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-create-disabled">
        Screen <Text variant="code">{screen.id}</Text> is update-only (allowCreate: false) — open it
        from a row action with an entity id.
      </Banner>
    );
  }
  return (
    <EntityEditCreateBody
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
      {...(onSaved !== undefined && { onSaved })}
    />
  );
}

// ---- entity-list ----

function entityQueryCommand(featureName: string, entity: string, verb: "list"): string {
  return `${toKebab(featureName)}:query:${toKebab(entity)}:${verb}`;
}

// Server-side entity-query-handlers return the paged envelope
// `{ rows, nextCursor, total? }`. Narrow the useQuery generic to that
// shape so RenderList gets plain rows. `total` ist optional — Server
// liefert es nur wenn der Caller `totalCount: true` setzt.
type PagedRows = {
  readonly rows: Readonly<Record<string, unknown>>[];
  readonly nextCursor: string | null;
  readonly total?: number;
};

// Payload for the server-side list query handler (LIST_PAYLOAD_SCHEMA):
// search/sort/sortDirection/limit + offset/totalCount for pager mode OR
// cursor for infinite scroll. Shared by EntityListBody and
// ProjectionListBody so the two branches can't drift on this shape
// (fw#2165) — entity-only additions (screen.filter, faceted filters) are
// layered on top by the caller instead of living in here.
export function buildListQueryPayload(state: {
  readonly limit: number;
  readonly search: string;
  readonly sort: ListSort | null;
  readonly usePager: boolean;
  readonly page: number;
  readonly useInfinite: boolean;
  readonly cursor: string | undefined;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { limit: state.limit };
  if (state.search !== "") payload["search"] = state.search;
  if (state.sort !== null) {
    payload["sort"] = state.sort.field;
    payload["sortDirection"] = state.sort.dir;
  }
  if (state.usePager) {
    // page=1 → offset=0, page=2 → offset=limit, etc. Server clamps itself
    // when offset >= total.
    const offset = (state.page - 1) * state.limit;
    if (offset > 0) payload["offset"] = offset;
    // totalCount: extra COUNT(*) so the pager can render "Page X of Y".
    payload["totalCount"] = true;
  } else if (state.useInfinite && state.cursor !== undefined) {
    payload["cursor"] = state.cursor;
  }
  return payload;
}

// entityList adapter — one DataTableFacet per filterable select/boolean
// entity field, labels via the standard field/option i18n convention.
function resolveEntityFacetSpecs(
  fields: Readonly<Record<string, unknown>>,
  featureName: string,
  entityName: string,
  translate: Translate,
): ResolvedFacetSpec[] {
  const out: ResolvedFacetSpec[] = [];
  for (const [field, rawDef] of Object.entries(fields)) {
    // entity.fields ist am Renderer-Layer schwach getypt (Record<string,
    // unknown>, vom Schema deserialisiert) — Boundary-Cast wie buildInitialValues.
    const def = rawDef as {
      type?: string;
      filterable?: boolean;
      options?: readonly string[];
      entity?: string;
      labelField?: string;
    };
    if (def.filterable !== true) continue;
    const label = translate(fieldLabelKey(featureName, entityName, field));
    if (def.type === "select" && Array.isArray(def.options)) {
      out.push({
        field,
        type: "select",
        label,
        options: def.options.map((value) => ({
          value,
          label: translate(fieldOptionLabelKey(featureName, entityName, field, value)),
        })),
      });
    } else if (def.type === "boolean") {
      out.push({
        field,
        type: "boolean",
        label,
        options: [
          {
            value: "true",
            label: translate(fieldOptionLabelKey(featureName, entityName, field, "true")),
          },
          {
            value: "false",
            label: translate(fieldOptionLabelKey(featureName, entityName, field, "false")),
          },
        ],
      });
    } else if (def.type === "reference" && def.entity !== undefined) {
      const target = parseRefTarget(def.entity, featureName);
      out.push({
        field,
        type: "reference",
        label,
        options: [],
        reference: {
          refEntity: target.entityName,
          refFeature: target.featureName,
          labelField: def.labelField ?? "id",
        },
      });
    }
  }
  return out;
}

// ---- drawer-kind actions: ToolbarAction (fw#2225) + RowAction (fw#2710) ----
//
// Shared across EntityListBody, ProjectionListBody, ProjectionDetailBody and
// EntityEditUpdateForm: state for "which drawer-kind action is currently
// open" plus a host component that mounts the referenced actionForm inside
// the Drawer primitive. Reuses ActionFormBody (no second, parallel form
// renderer) with onSuccess/onCancelOverride so submit-success closes the
// drawer + refetches the host screen instead of navigating, mirroring what
// a full-page actionForm would do via `redirect`. The only difference
// between the toolbar and row variants is prefill: a row action extracts
// `initialValues` from the clicked row (see buildProjectionRowActions /
// EntityListBody's rowActions builder); the toolbar variant has none.
type DrawerLikeAction = Extract<ToolbarAction, { kind: "drawer" }> | RowActionDrawer;

function useDrawerAction(schema: FeatureSchema): {
  readonly drawerAction: DrawerLikeAction | null;
  readonly drawerScreen: ActionFormScreenDefinition | undefined;
  readonly drawerInitialValues: Readonly<Record<string, unknown>> | undefined;
  readonly openDrawer: (
    action: DrawerLikeAction,
    initialValues?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly closeDrawer: () => void;
} {
  const [drawerState, setDrawerState] = useState<{
    readonly action: DrawerLikeAction;
    readonly initialValues: Readonly<Record<string, unknown>> | undefined;
  } | null>(null);
  const drawerAction = drawerState?.action ?? null;
  const drawerScreen = useMemo(() => {
    if (drawerAction === null) return undefined;
    // Same same-feature, short-id resolution as runNavigate — the drawer's
    // `screen` reference is scoped to schema.screens, not cross-feature.
    return schema.screens.find(
      (s): s is ActionFormScreenDefinition =>
        s.type === "actionForm" && lastSegment(s.id) === drawerAction.screen,
    );
  }, [drawerAction, schema.screens]);
  const openDrawer = useCallback(
    (action: DrawerLikeAction, initialValues?: Readonly<Record<string, unknown>>) =>
      setDrawerState({ action, initialValues }),
    [],
  );
  const closeDrawer = useCallback(() => setDrawerState(null), []);
  return {
    drawerAction,
    drawerScreen,
    drawerInitialValues: drawerState?.initialValues,
    openDrawer,
    closeDrawer,
  };
}

function DrawerHost({
  schema,
  drawerAction,
  drawerScreen,
  drawerInitialValues,
  userRoles,
  translate,
  onClose,
  onSuccess,
}: {
  readonly schema: FeatureSchema;
  readonly drawerAction: DrawerLikeAction | null;
  readonly drawerScreen: ActionFormScreenDefinition | undefined;
  readonly drawerInitialValues?: Readonly<Record<string, unknown>>;
  readonly userRoles: readonly string[] | undefined;
  readonly translate?: Translate;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}): ReactNode {
  const { Drawer, Dialog } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const locale = useLocale().locale();
  const [hasUnsavedInput, setHasUnsavedInput] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const closeAndReset = useCallback(() => {
    setHasUnsavedInput(false);
    setConfirmDiscardOpen(false);
    onClose();
  }, [onClose]);
  const requestClose = useCallback(() => {
    if (hasUnsavedInput) setConfirmDiscardOpen(true);
    else closeAndReset();
  }, [hasUnsavedInput, closeAndReset]);
  // Drawer is an optional Core-Primitive (additive rollout) — same "skip +
  // warn" precedent as rowActions without a mounted DispatcherProvider above,
  // instead of crashing when a web app hasn't upgraded its createKumikoApp
  // wiring yet. The warning repeats per mount and whenever the action changes.
  // Dev-time setup error, so no dedupe.
  useEffect(() => {
    if (drawerAction !== null && Drawer === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning for a setup error
      console.warn(
        `[kumiko] toolbarAction "${drawerAction.id}" is kind:"drawer", but no <Drawer> primitive is registered — it will not open. createKumikoApp() from kumiko-renderer-web wires it automatically.`,
      );
    }
  }, [drawerAction, Drawer]);

  if (drawerAction === null || Drawer === undefined) return null;

  // Access mirrors kind:"navigate" exactly: the toolbar button itself stays
  // visible either way (same as navigate — access is enforced at the
  // target, not by hiding the trigger), but the drawer shows the same
  // "Access denied" state KumikoScreen's top-level gate would show for a
  // direct hit on that screen, never the form.
  const allowed = screenAccessAllows(drawerScreen?.access, userRoles);
  const titleParams = formatSummaryParams(drawerInitialValues, locale);

  return (
    <>
      <Drawer
        open={true}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        title={effectiveTranslate(drawerAction.title ?? drawerAction.label, titleParams)}
        {...(drawerAction.subtitle !== undefined && {
          subtitle: effectiveTranslate(drawerAction.subtitle, titleParams),
        })}
        testId={`toolbar-drawer-${drawerAction.id}`}
      >
        <PageHeaderSlotAvailableProvider value={false}>
          <InsideDrawerProvider value={true}>
            {drawerScreen === undefined ? (
              <ScreenMissingState
                screenQn={drawerAction.screen}
                testId="kumiko-toolbar-drawer-not-found"
              />
            ) : !allowed ? (
              <ScreenAccessDeniedBanner
                screenQn={drawerAction.screen}
                testId="kumiko-toolbar-drawer-access-denied"
              />
            ) : (
              <ActionFormBody
                schema={schema}
                screen={drawerScreen}
                {...(translate !== undefined && { translate })}
                {...(drawerInitialValues !== undefined && {
                  initialOverrides: drawerInitialValues,
                })}
                onSuccess={() => {
                  setHasUnsavedInput(false);
                  onSuccess();
                }}
                onCancelOverride={requestClose}
                onDirtyChange={setHasUnsavedInput}
                submitLabelFallback={drawerAction.label}
              />
            )}
          </InsideDrawerProvider>
        </PageHeaderSlotAvailableProvider>
      </Drawer>
      <Dialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title={t("kumiko.drawer.discard.title")}
        description={t("kumiko.drawer.discard.body")}
        confirmLabel={t("kumiko.drawer.discard.confirm")}
        cancelLabel={t("kumiko.drawer.discard.cancel")}
        variant="danger"
        initialFocus="cancel"
        onConfirm={closeAndReset}
        testId="drawer-discard-dialog"
      />
    </>
  );
}

function EntityListScreen({
  schema,
  screen,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityListScreenDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const { Banner, Text } = usePrimitives();
  const entity = schema.entities[screen.entity];
  if (!entity) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-entity-missing">
        Entity <Text variant="code">{screen.entity}</Text> referenced by screen{" "}
        <Text variant="code">{screen.id}</Text> not registered in the schema.
      </Banner>
    );
  }
  // Entity resolved — mount the inner component so useQuery only fires
  // when there's actually something to render. A missing entity is a
  // dev-error state; no point hitting the server for it.
  return (
    <EntityListBody
      schema={schema}
      screen={screen}
      entity={entity}
      {...(translate !== undefined && { translate })}
      {...(onRowClick !== undefined && { onRowClick })}
    />
  );
}

function EntityListBody({
  schema,
  screen,
  entity,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: EntityListScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const isEmbeddedScreen = useIsEmbeddedScreen();
  const featureName = schema.featureName;
  const resolvedCreate = useNavigateToCreateFor(
    schema,
    screen.entity,
    screen.createScreen,
    screen.createUnavailable,
  );
  const onCreate = screen.allowCreate === false ? undefined : resolvedCreate;
  const { Banner } = usePrimitives();
  const queryType = entityQueryCommand(featureName, screen.entity, "list");
  const nav = useNav();
  const host = useReturnHost();
  const userRoles = useUserRoles();
  const appFeatures = useAppFeatures();
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  const defaultEditScreen = useMemo(
    () => findEditScreenFor(screen.entity, appFeatures, userRoles),
    [appFeatures, screen.entity, userRoles],
  );

  // URL-State: sort/dir/q/page leben unter dem screen.id-Namespace
  // (`/orders?orders.sort=createdAt&orders.dir=desc&orders.q=acme`),
  // damit zwei Lists auf derselben Route nicht über dieselben
  // Query-Keys streiten. Default-Sort aus der Screen-Def gewinnt nur
  // wenn URL keinen sort hat — Author-Default vs User-Choice.
  const defaultFilters = useMemo(
    () => normalizeDefaultFilters(screen.defaultFilters),
    [screen.defaultFilters],
  );
  const urlState = useListUrlState(screen.id, defaultFilters);
  const effectiveSort = urlState.sort ?? screen.defaultSort ?? null;
  const limit = urlState.pageSize ?? screen.pageSize ?? 50;
  const paginationMode = screen.pagination ?? "pages";
  const usePager = paginationMode === "pages";
  const useInfinite = paginationMode === "infinite";

  // Infinite-Scroll: lokaler State akkumuliert rows über mehrere
  // useQuery-Aufrufe (statt replacen wie bei Pager). cursor wechselt
  // wenn der User den Bottom-Sentinel erreicht; bei sort/q-Change
  // resetten wir alles, da die Insert-Order der akkumulierten Rows
  // sonst inkonsistent ist mit der neuen Sortierung.
  const [accumulated, setAccumulated] = useState<readonly Readonly<Record<string, unknown>>[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  // Ref damit der useEffect-Cleanup nicht alten state sieht.
  const sortQRef = useRef<string>("");
  const sortQKey = `${urlState.q}|${effectiveSort?.field ?? ""}|${effectiveSort?.dir ?? ""}`;
  // Bei sort/q-Wechsel rows + cursor reseten — vor dem nächsten useQuery
  // damit der Reload mit cursor=undefined startet.
  useEffect(() => {
    if (!useInfinite) return;
    if (sortQRef.current === sortQKey) return;
    sortQRef.current = sortQKey;
    setAccumulated([]);
    setCursor(undefined);
    setHasMore(true);
  }, [useInfinite, sortQKey]);

  // User-gewählte Faceted-Filter aus dem URL-State → payload.filters.
  // typeOf liest den Field-Type direkt aus entity.fields (nicht gated auf
  // filterable — bewusst permissiv, siehe buildFilterPayload-Doc).
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(urlState.filters, (field) => {
        // entity.fields ist am Renderer-Layer schwach getypt (vom Schema
        // deserialisiert) — Boundary-Cast wie buildInitialValues.
        const type = propertyOf(entity.fields[field], "type");
        return typeof type === "string" ? type : undefined;
      }),
    [urlState.filters, entity.fields],
  );

  // Entity-only additions (screen.filter, faceted filters) layer on top of
  // the shared buildListQueryPayload — projectionList has neither.
  const queryPayload = useMemo(() => {
    const payload = buildListQueryPayload({
      limit,
      search: urlState.q,
      sort: effectiveSort,
      usePager,
      page: urlState.page,
      useInfinite,
      cursor,
    });
    // Screen-Filter (Tier 2.7c) — vom Author am Schema deklariert,
    // unabhängig vom User-q-Search. Mehrere Buckets derselben Entity
    // ("Upcoming" / "Active" / "Past") nutzen unterschiedliche filter
    // bei gleichem Query-Handler.
    if (screen.filter !== undefined) {
      payload["filter"] = screen.filter;
    }
    if (filterPayload.length > 0) {
      payload["filters"] = filterPayload;
    }
    return payload;
  }, [
    limit,
    urlState.q,
    effectiveSort,
    screen.filter,
    filterPayload,
    usePager,
    urlState.page,
    useInfinite,
    cursor,
  ]);

  const rowsQuery = useQuery<PagedRows>(queryType, queryPayload, { live: true });

  // Facet counts come from their own queries, which a write leaves untouched.
  const [facetCountRefreshNonce, setFacetCountRefreshNonce] = useState(0);
  const refreshFacetCounts = useCallback(() => setFacetCountRefreshNonce((n) => n + 1), []);

  const refreshRowsAfterWrite = useCallback(async () => {
    refreshFacetCounts();
    if (useInfinite) {
      setAccumulated([]);
      setCursor(undefined);
      setHasMore(true);
      return;
    }
    await refetchAfterWrite(rowsQuery.refetch);
  }, [useInfinite, rowsQuery.refetch, refreshFacetCounts]);

  // Infinite-Scroll: bei jedem erfolgreichen Result die rows appenden +
  // hasMore aus nextCursor ableiten. Live-Updates (postgres NOTIFY) und
  // initiale Loads laufen beide hier durch — das useEffect-Dep-Array
  // pinnt die Dedup auf dem letzten verarbeiteten data-Pointer.
  const lastDataRef = useRef<PagedRows | null>(null);
  useEffect(() => {
    if (!useInfinite) return;
    const data = rowsQuery.data;
    if (data === null) return;
    if (data === lastDataRef.current) return;
    lastDataRef.current = data;
    setAccumulated((prev) => {
      // Wenn cursor undefined ist, ist das die erste Page nach
      // sort/q-Change → komplett ersetzen statt anhängen. Sonst dedupe
      // auf id falls Live-Updates einen Eintrag in der nächsten Page
      // bringen die schon angehängt war.
      if (cursor === undefined) return data.rows;
      const seen = new Set<unknown>(prev.map((r) => r["id"]));
      const fresh = data.rows.filter((r) => !seen.has(r["id"]));
      return [...prev, ...fresh];
    });
    setHasMore(data.nextCursor !== null);
  }, [rowsQuery.data, useInfinite, cursor]);

  const loadMore = useCallback(() => {
    if (!useInfinite) return;
    if (rowsQuery.loading) return;
    const data = rowsQuery.data;
    if (data?.nextCursor === undefined || data.nextCursor === null) return;
    setCursor(data.nextCursor);
  }, [useInfinite, rowsQuery.loading, rowsQuery.data]);

  // RowActions: Schema-Form (handler-QN + i18n-Key) → Resolved-Form
  // (dispatcher-Call + translated Strings). dispatcher.write kennt den
  // User intern (JWT-Cookie). Schema kann sowohl raw-Strings als auch
  // i18n-Keys enthalten — translate() returnt den Key wenn das Bundle
  // ihn nicht kennt (Convention überall im Renderer).
  // Hooks-Reihenfolge: ALLE Hooks vor early-return für loading/error,
  // sonst kollidieren die Hook-Slots zwischen Renders.
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;

  // Faceted-Filter: ein Dropdown pro filterable select/boolean/reference-Feld.
  // Labels + select-Option-Labels über dieselbe i18n-Konvention wie die
  // Spalten-Header (fieldLabelKey / :option:<value>); reference-Felder laden
  // ihre Optionen asynchron über ReferenceFacetBridges.
  const entityFacetSpecs = useMemo(
    () => resolveEntityFacetSpecs(entity.fields, featureName, screen.entity, effectiveTranslate),
    [entity.fields, featureName, screen.entity, effectiveTranslate],
  );
  const [entityReferenceFacetOptions, setEntityReferenceFacetOptions] = useState<
    Record<string, readonly ReferenceFacetOption[]>
  >({});
  const handleEntityFacetOptions = useCallback(
    (field: string, options: readonly ReferenceFacetOption[]) =>
      setEntityReferenceFacetOptions((prev) =>
        prev[field] === options ? prev : { ...prev, [field]: options },
      ),
    [],
  );
  const [facetCounts, setFacetCounts] = useState<Record<string, number>>({});
  const handleFacetCount = useCallback(
    (key: string, count: number) =>
      setFacetCounts((prev) => (prev[key] === count ? prev : { ...prev, [key]: count })),
    [],
  );
  const filterFacets = useMemo<DataTableFacet[]>(
    () =>
      buildEntityFilterFacets(
        mergeReferenceFacetOptions(entityFacetSpecs, entityReferenceFacetOptions),
        screen.facets,
        effectiveTranslate,
        facetCounts,
      ),
    [entityFacetSpecs, entityReferenceFacetOptions, screen.facets, effectiveTranslate, facetCounts],
  );
  const facetCountQueries = useMemo<FacetCountQuery[]>(
    () =>
      buildFacetCountRequests(entityFacetSpecs, screen.facets, effectiveTranslate).map(
        (request) => {
          const filters = buildFilterPayload(
            { ...urlState.filters, [request.field]: request.values },
            (field) => entity.fields[field]?.type,
          );
          return {
            key: request.key,
            payload: {
              limit: 1,
              totalCount: true,
              ...(urlState.q !== "" && { search: urlState.q }),
              ...(screen.filter !== undefined && { filter: screen.filter }),
              ...(filters.length > 0 && { filters }),
            },
          };
        },
      ),
    [
      entityFacetSpecs,
      screen.facets,
      screen.filter,
      effectiveTranslate,
      urlState.filters,
      urlState.q,
      entity.fields,
    ],
  );

  // Soft-Dispatcher: in Tests die ohne DispatcherProvider mounten,
  // bleibt rowActions undefined statt zu crashen. Echte Apps haben
  // den Provider via createKumikoApp — wenn nicht, ist es vermutlich
  // ein Setup-Fehler, also einmal warnen damit der Author das findet
  // (sonst rendert die Action-Spalte still nichts und der "warum sind
  // meine Buttons weg?"-Debug ist teuer).
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const hasRowActions = screen.rowActions !== undefined && screen.rowActions.length > 0;
  useEffect(() => {
    if (hasRowActions && dispatcher === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning für Setup-Fehler
      console.warn(
        `[kumiko] Screen "${screen.id}" deklariert rowActions, aber kein <DispatcherProvider> ist mounted — die Action-Spalte wird nicht gerendert. createKumikoApp() wired den Provider automatisch.`,
      );
    }
  }, [hasRowActions, dispatcher, screen.id]);
  // Discriminated Union: writeHandler (default) dispatched einen Server-
  // Handler, navigate ruft nav.navigate() ggf. mit URL-Search-Params aus
  // params(row). nav lebt schon weiter unten in EntityListBody-Scope.
  // Gemeinsame navigate-Ausführung: sowohl das "…"-Aktionsmenü (rowActions) als
  // auch der Row-Body-Klick (rowClick) laufen hierdurch — ein Pfad, damit beide
  // nicht auseinanderdriften.
  const runNavigate = useCallback(
    (action: RowActionNavigate, row: ListRowViewModel) => {
      if (action.entity !== undefined) {
        // Entity-Targets (fw#2228) lösen sich erst in der NavApi-Impl gegen
        // ALLE Features auf (resolveTarget in renderer-web/nav.tsx) — dieses
        // Package kennt nur `schema` (das eine aufrufende Feature) und kann
        // detailFor cross-feature nicht selbst nachschlagen.
        const explicit =
          action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
        // Same-entity only — cross-entity targets must declare entityId (boot-validator).
        const fallback =
          action.entity === screen.entity ? String(row.values["id"] ?? "") : undefined;
        const id = explicit ?? fallback ?? "";
        if (id === "") return;
        const params = navigateActionSearchParams(action, row.values);
        navigateWithReturnTo(nav, { entity: action.entity, id }, host, params);
      } else if (action.screen !== undefined) {
        // Default entityId für entityEdit-Targets: row["id"] wenn kein expliziter
        // entityId-Feldname gesetzt ist. Nur für Targets DERSELBEN Entity — sonst
        // bekäme ein Cross-Entity-Edit-Screen die falsche row.id injiziert.
        const targetIsEntityEdit = isEntityEditScreenOfEntity(
          screen.entity,
          action.screen,
          schema,
          appFeatures,
        );
        const explicit =
          action.entityId !== undefined ? String(row.values[action.entityId] ?? "") : undefined;
        const fallback = targetIsEntityEdit ? String(row.values["id"] ?? "") : undefined;
        const entityId = explicit ?? fallback;
        const target: ScreenTarget = {
          screenId: action.screen,
          ...(entityId !== undefined && entityId !== "" && { entityId }),
        };
        // setSearchParams nimmt string|null — komplexe Werte zu String (der Reader
        // kennt via URL nur Strings). Known-edge: zielt die Action auf den
        // AKTUELLEN pathname, mergen die Params auf den alten ?-String (für
        // Row-Actions praktisch nicht erreichbar, Pfad differiert).
        const params = navigateActionSearchParams(action, row.values);
        navigateWithReturnTo(nav, target, host, params);
      }
    },
    [nav, schema, appFeatures, screen.entity, host],
  );

  const rowActions = useMemo(() => {
    const declared = screen.rowActions ?? [];
    // Prepended unless a declared rowAction already has id "edit" — declared wins.
    const declaredHasEdit = declared.some((a) => a.id === "edit");
    const defaultEditRowAction = declaredHasEdit
      ? undefined
      : buildDefaultEditRowAction(defaultEditScreen);
    const effectiveActions: readonly RowAction[] =
      defaultEditRowAction !== undefined ? [defaultEditRowAction, ...declared] : declared;
    if (effectiveActions.length === 0) return undefined;
    return effectiveActions
      .map((action: RowAction): DataTableRowAction | null => {
        // navigate-Variante braucht keinen Dispatcher; nav ist
        // immer da (Provider von createKumikoApp).
        if (action.kind === "navigate") {
          const navigateAction = action;
          const actionVisible = action.visible;
          const actionIcon = resolveActionIcon(action.id, action.icon);
          return {
            id: action.id,
            label: effectiveTranslate(action.label),
            ...(action.style !== undefined && { style: action.style }),
            ...(action.display !== undefined && { display: action.display }),
            confirmRequired: false,
            ...(navigateAction.rowClick === true && { rowClick: true }),
            ...(actionIcon !== undefined && { icon: actionIcon }),
            onTrigger: (row: ListRowViewModel) => runNavigate(navigateAction, row),
            ...(actionVisible !== undefined && {
              isVisible: (row: ListRowViewModel) => evalFieldCondition(actionVisible, row.values),
            }),
          };
        }
        if (action.kind === "drawer") {
          return buildDrawerRowAction(action, effectiveTranslate, openDrawer);
        }
        if (action.kind === "clientAction") {
          return buildClientActionRowAction(
            action,
            effectiveTranslate,
            clientActions,
            refreshRowsAfterWrite,
          );
        }
        if (dispatcher === undefined) return null;
        const writeAction = action;
        const writeActionVisible = writeAction.visible;
        return {
          id: writeAction.id,
          label: effectiveTranslate(writeAction.label),
          style: writeAction.style,
          icon: resolveActionIcon(writeAction.id, writeAction.icon),
          confirm:
            writeAction.confirm !== undefined ? effectiveTranslate(writeAction.confirm) : undefined,
          confirmLabel:
            writeAction.confirmLabel !== undefined
              ? effectiveTranslate(writeAction.confirmLabel)
              : undefined,
          onTrigger: async (row: ListRowViewModel) => {
            const buildPayload = writeAction.payload;
            const payload =
              buildPayload !== undefined
                ? evalRowExtractor(buildPayload, row.values)
                : { id: row.values["id"] };
            const result = await dispatcher.write(writeAction.handler, payload);
            // write() wirft nicht — Failure-Result MUSS hier zum Error
            // werden, sonst schließt der Confirm-Dialog kommentarlos und
            // der User sieht "nichts passiert" (Prod-Bug 2026-06-07).
            if (!result.isSuccess) {
              throw new WriteFailedError(
                result.error,
                dispatcherErrorText(result.error, effectiveTranslate),
              );
            }
            await refreshRowsAfterWrite();
          },
          isVisible:
            writeActionVisible !== undefined
              ? (row: ListRowViewModel) => evalFieldCondition(writeActionVisible, row.values)
              : undefined,
        };
      })
      .filter((a: DataTableRowAction | null): a is DataTableRowAction => a !== null);
  }, [
    screen.rowActions,
    defaultEditScreen,
    effectiveTranslate,
    dispatcher,
    clientActions,
    runNavigate,
    refreshRowsAfterWrite,
    openDrawer,
  ]);

  // ToolbarActions: Schema → Resolved-Form (analog rowActions), shared with
  // projectionList and relatedList sections via buildProjectionToolbarActions.
  const toolbarActions = useMemo(
    () =>
      buildProjectionToolbarActions({
        toolbarActions: screen.toolbarActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: refreshRowsAfterWrite,
        openDrawer,
        host,
      }),
    [
      screen.toolbarActions,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      refreshRowsAfterWrite,
      openDrawer,
    ],
  );
  const emptyContent = useListEmptyContent(screen.emptyState, effectiveTranslate, {
    nav,
    host,
    dispatcher,
    openDrawer,
    onWriteSuccess: refreshRowsAfterWrite,
  });

  // Expandable rows: open state is keyed by row id, so it survives refetch,
  // sort and page changes. Several rows can be open at once.
  const expandableRow = screen.expandableRow;
  const expandableSection = useMemo(
    () =>
      expandableRow !== undefined
        ? computeRelatedListSectionViewModel(expandableRow, effectiveTranslate)
        : undefined,
    [expandableRow, effectiveTranslate],
  );
  const [expandedRowIds, setExpandedRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRowExpanded = useCallback((rowId: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);
  // Bumped after a write that ran outside the sub-list (drawer submit,
  // title-row action) so open sub-lists remount and reload.
  const [expansionNonce, setExpansionNonce] = useState(0);
  const invalidateExpansions = useCallback(() => setExpansionNonce((n) => n + 1), []);
  const renderExpandedRow = useCallback(
    (row: ListRowViewModel): ReactNode =>
      expandableSection === undefined ? null : (
        <EntityListExpandedRow
          section={expandableSection}
          row={row}
          featureName={featureName}
          {...(translate !== undefined && { translate })}
          expansionNonce={expansionNonce}
          openDrawer={openDrawer}
          onAfterWrite={refreshRowsAfterWrite}
          onSubListInvalidated={invalidateExpansions}
        />
      ),
    [
      expandableSection,
      featureName,
      translate,
      expansionNonce,
      openDrawer,
      refreshRowsAfterWrite,
      invalidateExpansions,
    ],
  );

  if (rowsQuery.loading && rowsQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (rowsQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(rowsQuery.error, effectiveTranslate)}
      </Banner>
    );
  }

  // RenderList's onRowClick is a 1-arg callback; KumikoScreen's
  // 2-arg shape (row, entityName) is the public surface — thread the
  // screen's entity through here so callers don't have to re-derive
  // it.
  // Row-Body-Klick: eine explizit als rowClick markierte navigate-rowAction
  // gewinnt (deklarierte Author-Absicht "Klick auf die Zeile tut X"). Ohne Flag
  // bleibt der Pfad unverändert — create-app's entityEdit-Default bzw. ein vom
  // App-Author gesetztes onRowClick.
  const rowClickAction = findRowClickAction(screen.rowActions);
  const wrappedOnRowClick = rowClickAction
    ? (row: ListRowViewModel) =>
        rowClickAction.kind === "drawer"
          ? runDrawerRowAction(rowClickAction, openDrawer, row)
          : runNavigate(rowClickAction, row)
    : onRowClick !== undefined
      ? (row: ListRowViewModel) => onRowClick(row, screen.entity)
      : undefined;

  // Searchable default: explicit author choice wins, otherwise auto-on when
  // the entity has searchable fields (dead toolbar slot otherwise — the
  // server search index has nothing to filter). Gated on
  // schema.searchAdapterMissing !== true regardless of source (explicit or
  // auto) — a search bar the server can't serve would 422 at request-time
  // (#2032); matches the boot-time check in api/server.ts (#2051).
  const searchable =
    schema.searchAdapterMissing !== true &&
    (screen.searchable ??
      Object.values(entity.fields).some((f) => "searchable" in f && f.searchable === true));

  // Pager-Props nur bei pagination="pages" zusammenstellen. Server-
  // total kommt async — bis es da ist, rendert RenderList die Tabelle
  // ohne Pager (Pager hat eine eigene total>0-Guard).
  const total = rowsQuery.data?.total;
  const pager =
    usePager && total !== undefined
      ? {
          page: urlState.page,
          limit,
          total,
          onPageChange: urlState.setPage,
          pageSizeOptions: pageSizeOptionsFor(limit),
          onPageSizeChange: urlState.setPageSize,
        }
      : undefined;

  // Bei Infinite-Mode: rows kommen aus accumulated (über mehrere
  // useQuery-Calls gesammelt), bei pages/false aus dem aktuellen Result.
  const renderRows = useInfinite ? accumulated : (rowsQuery.data?.rows ?? []);

  return (
    <>
      <ReferenceFacetBridges specs={entityFacetSpecs} onOptions={handleEntityFacetOptions} />
      <FacetCountBridges
        queryType={queryType}
        queries={facetCountQueries}
        onCount={handleFacetCount}
        refreshNonce={facetCountRefreshNonce}
      />
      <RenderList
        screen={screen}
        entity={entity}
        rows={renderRows}
        featureName={featureName}
        searchable={searchable}
        narrowed={isListNarrowed(urlState.q, urlState.filters, defaultFilters)}
        {...(screen.description !== undefined && {
          description: effectiveTranslate(screen.description),
        })}
        {...(emptyContent !== undefined && { emptyContent })}
        searchValue={urlState.q}
        onSearchChange={urlState.setQ}
        sort={effectiveSort}
        onSortChange={urlState.setSort}
        {...(isEmbeddedScreen
          ? { screenPadding: false, chromeless: true }
          : { screenPadding: true })}
        {...(screenFillsHeight(screen) && { scrollBody: true })}
        {...(pager !== undefined && { pager })}
        {...(rowActions !== undefined && { rowActions })}
        {...(screen.rowActionMode !== undefined && { rowActionMode: screen.rowActionMode })}
        {...(toolbarActions !== undefined && toolbarActions.length > 0 && { toolbarActions })}
        {...(useInfinite && {
          onReachEnd: loadMore,
          loadingMore: rowsQuery.loading,
          hasMore,
        })}
        {...(onCreate !== undefined && { onCreate })}
        {...(translate !== undefined && { translate })}
        {...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick })}
        {...(filterFacets.length > 0 && {
          filterFacets,
          filterValues: urlState.filters,
          onFilterChange: urlState.setFilter,
          onFilterReset: urlState.clearFilters,
        })}
        {...(expandableSection !== undefined && {
          expandedRowIds,
          onToggleRowExpanded: toggleRowExpanded,
          renderExpandedRow,
        })}
      />
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerInitialValues !== undefined && { drawerInitialValues })}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          invalidateExpansions();
          refreshFacetCounts();
          void rowsQuery.refetch();
        }}
      />
    </>
  );
}

// ---- projection-list ----

// Like entityList, but the list query comes DIRECTLY from `screen.query`
// (instead of being derived from an entity) — cross-feature capable.
// search/sort/pagination reuse the same URL-state + buildListQueryPayload
// wiring as EntityListBody; which of them are actually offered is derived
// from the query handler's Zod schema at buildAppSchema time (fw#2165), not
// declared here. Pages-mode pagination only — infinite-scroll accumulation
// isn't wired for projectionList.
function ProjectionListBody({
  schema,
  screen,
  translate,
  onRowClick,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ProjectionListScreenDefinition;
  readonly translate?: Translate;
  readonly onRowClick?: (row: ListRowViewModel, entityName: string) => void;
}): ReactNode {
  const isEmbeddedScreen = useIsEmbeddedScreen();
  const { Banner, Text } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  const host = useReturnHost();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const effectiveTranslate = translate ?? t;
  const userRoles = useUserRoles();
  const appFeatures = useAppFeatures();
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
  const defaultEditScreen = useMemo(() => {
    const detailFor = screen.detailFor;
    if (detailFor === undefined) return undefined;
    return findEditScreenFor(detailFor, appFeatures, userRoles);
  }, [appFeatures, screen.detailFor, userRoles]);

  // searchable/sortable/paginated are derived at buildAppSchema time from the
  // query handler's Zod schema (fw#2165) — not authored on the screen.
  const searchable = screen.searchable ?? false;
  const sortable = screen.sortable ?? false;
  const paginated = screen.paginated ?? false;
  const entity = useMemo(
    () => synthesizeProjectionEntity(screen.columns, sortable),
    [screen.columns, sortable],
  );
  const listScreen = useMemo(() => synthesizeProjectionScreen(screen), [screen]);

  const urlState = useListUrlState(screen.id);
  // Gated on the derived capability, not just on whether URL-state happens to
  // carry a value — a stale/hand-crafted URL (?…q=x on a non-searchable
  // screen) must not smuggle a param the query's Zod schema doesn't accept.
  const activeSearch = searchable ? urlState.q : "";
  // Same predicate that makes a header clickable: a stale link onto a
  // sortable:false/unknown column must not reach the server (it answers 400).
  const urlSort = urlState.sort;
  const urlSortField = urlSort === null ? undefined : entity.fields[urlSort.field];
  const urlSortAllowed =
    urlSortField !== undefined && "sortable" in urlSortField && urlSortField.sortable === true;
  const activeSort = sortable
    ? ((urlSortAllowed ? urlSort : null) ?? screen.defaultSort ?? null)
    : null;
  const limit = urlState.pageSize ?? screen.pageSize ?? 50;
  // Pages-mode only (see header comment) — an author-set pagination:
  // "infinite" on a paginated projectionList is silently a no-op today.
  const usePager = paginated && (screen.pagination ?? "pages") === "pages";

  // Facets (fw#2224) — a projectionList has no entity, so screen.facets is
  // the only field inventory; resolveProjectionFacetSpecs reshapes +
  // translates its explicit labels into the same ResolvedFacetSpec the
  // entityList adapter produces, so both feed the same
  // buildFilterFacets/buildFilterPayload.
  const facetSpecs = useMemo(
    () => resolveProjectionFacetSpecs(screen.facets, effectiveTranslate, schema.featureName),
    [screen.facets, effectiveTranslate, schema.featureName],
  );
  const [projectionReferenceFacetOptions, setProjectionReferenceFacetOptions] = useState<
    Record<string, readonly ReferenceFacetOption[]>
  >({});
  const handleProjectionFacetOptions = useCallback(
    (field: string, options: readonly ReferenceFacetOption[]) =>
      setProjectionReferenceFacetOptions((prev) =>
        prev[field] === options ? prev : { ...prev, [field]: options },
      ),
    [],
  );
  const resolvedFacetSpecs = useMemo(
    () => mergeReferenceFacetOptions(facetSpecs, projectionReferenceFacetOptions),
    [facetSpecs, projectionReferenceFacetOptions],
  );
  const filterPayload = useMemo(
    () =>
      buildFilterPayload(
        urlState.filters,
        (field) => facetSpecs.find((spec) => spec.field === field)?.type,
      ),
    [urlState.filters, facetSpecs],
  );

  // dateRange facets (fw#3104) bypass `filters` entirely — their two bounds
  // become the top-level query params the facet declares, resolved from a
  // calendar date to an instant in the viewer's zone.
  const timeZone = useOptionalTimeZone();
  const dateRangeSpecs = useMemo(
    () => resolveDateRangeFacets(screen.facets, effectiveTranslate),
    [screen.facets, effectiveTranslate],
  );
  const dateRangePayload = useMemo(
    () => buildDateRangePayload(dateRangeSpecs, urlState.filters, timeZone),
    [dateRangeSpecs, urlState.filters, timeZone],
  );

  const queryPayload = useMemo(() => {
    const payload = buildListQueryPayload({
      limit,
      search: activeSearch,
      sort: activeSort,
      usePager,
      page: urlState.page,
      useInfinite: false,
      cursor: undefined,
    });
    // Gated on screen.filter/screen.facets being declared (not just on
    // urlState/filterPayload happening to carry a value) — same rule as
    // activeSearch/activeSort above: a stale URL must not smuggle a param
    // the bound query's Zod schema doesn't accept (fw#2165 pattern).
    if (screen.filter !== undefined) {
      payload["filter"] = screen.filter;
    }
    if (screen.facets !== undefined && filterPayload.length > 0) {
      payload["filters"] = filterPayload;
    }
    Object.assign(payload, dateRangePayload);
    return payload;
  }, [
    limit,
    activeSearch,
    activeSort,
    usePager,
    urlState.page,
    screen.filter,
    screen.facets,
    filterPayload,
    dateRangePayload,
  ]);

  const rowsQuery = useQuery<PagedRows>(screen.query, queryPayload, { live: true });

  const filterFacets = useMemo<DataTableFacet[]>(
    () => buildFilterFacets(resolvedFacetSpecs),
    [resolvedFacetSpecs],
  );
  const dateRangeFacets = useMemo<DataTableDateRangeFacet[]>(
    () =>
      dateRangeSpecs.map((spec) => ({
        field: spec.field,
        label: spec.label,
        ...readDateRange(urlState.filters, spec.field),
      })),
    [dateRangeSpecs, urlState.filters],
  );
  const handleDateRangeChange = useCallback(
    (field: string, bound: "from" | "to", value: string) => {
      urlState.setDateRange(
        field,
        clampDateRange(readDateRange(urlState.filters, field), bound, value),
      );
    },
    [urlState.setDateRange, urlState.filters],
  );

  // Entity-Targets (fw#2228) — see EntityListBody.runNavigate for why the
  // resolution happens in the NavApi impl. Unlike there: NO row["id"]
  // fallback — projectionList rows come from an arbitrary query projection
  // with no guaranteed "id" field. The boot validator therefore enforces an
  // explicit entityId for projectionList entity targets. Same helper
  // relatedList's rowActions reuse (related-list-section.tsx) — a
  // projectionDetail relatedList row has the identical "no guaranteed id"
  // shape.
  const runNavigate = useCallback(
    (action: RowActionNavigate, row: ListRowViewModel) =>
      runProjectionRowNavigate(nav, action, row, host),
    [nav, host],
  );

  const defaultEditRowAction = useMemo(
    () => buildDefaultEditRowAction(defaultEditScreen),
    [defaultEditScreen],
  );

  const rowActions = useMemo(
    () =>
      buildProjectionRowActions({
        rowActions: screen.rowActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: rowsQuery.refetch,
        openDrawer,
        defaultEditRowAction,
        host,
        clientActions,
      }),
    [
      screen.rowActions,
      effectiveTranslate,
      dispatcher,
      clientActions,
      nav,
      rowsQuery.refetch,
      openDrawer,
      defaultEditRowAction,
      host,
    ],
  );

  const toolbarActions = useMemo(
    () =>
      buildProjectionToolbarActions({
        toolbarActions: screen.toolbarActions,
        translate: effectiveTranslate,
        dispatcher,
        nav,
        refetch: rowsQuery.refetch,
        openDrawer,
        host,
      }),
    [
      screen.toolbarActions,
      effectiveTranslate,
      nav,
      host,
      dispatcher,
      rowsQuery.refetch,
      openDrawer,
    ],
  );
  const emptyContent = useListEmptyContent(screen.emptyState, effectiveTranslate, {
    nav,
    host,
    dispatcher,
    openDrawer,
    onWriteSuccess: rowsQuery.refetch,
  });

  if (rowsQuery.loading && rowsQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (rowsQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(rowsQuery.error, effectiveTranslate)}
      </Banner>
    );
  }

  // rowsQuery.data is typed as PagedRows but the query handler is free to
  // return anything at runtime (fw#2216: a bare array silently rendered an
  // empty table instead of surfacing the mismatch); a system-boundary cast
  // is needed to inspect the actual wire shape before trusting it.
  const rawRowsData = rowsQuery.data as unknown as { readonly rows?: unknown } | null;
  if (rawRowsData !== null && !Array.isArray(rawRowsData.rows)) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-projection-list-bad-shape">
        Screen <Text variant="code">{screen.id}</Text> query{" "}
        <Text variant="code">{screen.query}</Text> did not return a PagedRows envelope; a
        projectionList query must return <Text variant="code">{"{ rows, nextCursor }"}</Text>.
      </Banner>
    );
  }

  const rowClickAction = findRowClickAction(screen.rowActions);
  const wrappedOnRowClick = rowClickAction
    ? (row: ListRowViewModel) =>
        rowClickAction.kind === "drawer"
          ? runDrawerRowAction(rowClickAction, openDrawer, row)
          : runNavigate(rowClickAction, row)
    : onRowClick !== undefined
      ? (row: ListRowViewModel) => onRowClick(row, listScreen.entity)
      : undefined;

  // Same pager-construction as EntityListBody: no Pager UI until the
  // server-provided `total` arrives (guards pagination="pages" without
  // totalCount support, see fw#2165 report on solon's leaseOverviewHandler).
  const total = rowsQuery.data?.total;
  const pager =
    usePager && total !== undefined
      ? {
          page: urlState.page,
          limit,
          total,
          onPageChange: urlState.setPage,
          pageSizeOptions: pageSizeOptionsFor(limit),
          onPageSizeChange: urlState.setPageSize,
        }
      : undefined;

  return (
    <>
      <ReferenceFacetBridges specs={facetSpecs} onOptions={handleProjectionFacetOptions} />
      <RenderList
        screen={listScreen}
        entity={entity}
        rows={rowsQuery.data?.rows ?? []}
        featureName={schema.featureName}
        searchable={searchable}
        narrowed={isListNarrowed(activeSearch, urlState.filters)}
        {...(screen.description !== undefined && {
          description: effectiveTranslate(screen.description),
        })}
        {...(emptyContent !== undefined && { emptyContent })}
        searchValue={urlState.q}
        onSearchChange={urlState.setQ}
        sort={activeSort}
        onSortChange={urlState.setSort}
        {...(isEmbeddedScreen
          ? { screenPadding: false, chromeless: true }
          : { screenPadding: true })}
        {...(screenFillsHeight(listScreen) && { scrollBody: true })}
        {...(pager !== undefined && { pager })}
        {...(rowActions !== undefined && { rowActions })}
        {...(screen.rowActionMode !== undefined && { rowActionMode: screen.rowActionMode })}
        {...(toolbarActions !== undefined && { toolbarActions })}
        {...(translate !== undefined && { translate })}
        {...(wrappedOnRowClick !== undefined && { onRowClick: wrappedOnRowClick })}
        {...(filterFacets.length > 0 && {
          filterFacets,
          onFilterChange: urlState.setFilter,
        })}
        {...(dateRangeFacets.length > 0 && {
          dateRangeFacets,
          onDateRangeChange: handleDateRangeChange,
        })}
        {...((filterFacets.length > 0 || dateRangeFacets.length > 0) && {
          filterValues: urlState.filters,
          onFilterReset: urlState.clearFilters,
        })}
      />
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerInitialValues !== undefined && { drawerInitialValues })}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void rowsQuery.refetch();
        }}
      />
    </>
  );
}

function metricLabelKey(
  metric: MetricSpec,
  fieldLabels: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (typeof metric !== "string" && metric.label !== undefined) return metric.label;
  return fieldLabels?.[metricField(metric)];
}

function metricNavigateSpec(metric: MetricSpec): MetricNavigate | undefined {
  return typeof metric === "string" ? undefined : metric.navigate;
}

// Reuses runProjectionRowNavigate (row-actions.ts) instead of re-deriving
// navigate execution — a metric click has the same entity/screen/params
// shape as a RowActionNavigate, minus the fields (id, label, style) that
// function never reads.
function runMetricNavigate(
  nav: NavApi,
  navigate: MetricNavigate,
  record: Readonly<Record<string, unknown>>,
  host: ReturnHost | undefined,
): void {
  // tab alone (no screen/entity) stays on the current record and just
  // activates that tab — no route change, so runProjectionRowNavigate
  // (which always navigates) doesn't apply here.
  if (navigate.screen === undefined && navigate.entity === undefined) {
    if (navigate.tab !== undefined) nav.setSearchParams({ tab: navigate.tab });
    return;
  }
  const base = { kind: "navigate" as const, id: "metric-navigate", label: "" };
  const action: RowActionNavigate | undefined =
    navigate.entity !== undefined
      ? {
          ...base,
          entity: navigate.entity,
          ...(navigate.entityId !== undefined && { entityId: navigate.entityId }),
          ...(navigate.params !== undefined && { params: navigate.params }),
          ...(navigate.tab !== undefined && { tab: navigate.tab }),
        }
      : navigate.screen !== undefined
        ? {
            ...base,
            screen: navigate.screen,
            ...(navigate.entityId !== undefined && { entityId: navigate.entityId }),
            ...(navigate.params !== undefined && { params: navigate.params }),
            ...(navigate.tab !== undefined && { tab: navigate.tab }),
          }
        : undefined;
  if (action === undefined) return;
  runProjectionRowNavigate(nav, action, { id: "", values: record }, host);
}

// Absolute http(s) check for RecordHeaderSpec.subtitleHref — deliberately
// stricter than isSafeHref (which also allows relative paths and mailto:),
// since a relative/mailto value here should render as plain text, not a
// "_blank" external link.
function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && isSafeHref(value);
}

type SubtitlePartView = {
  readonly field: string;
  readonly text: string;
  readonly href?: string;
  readonly onPress?: () => void;
};

// hrefFor throws for an entity without a detailFor screen; outside
// createKumikoApp the feature list is empty, so navigateTargetAllows can't
// rule that out beforehand. The NavApi owns target resolution, so asking it
// and falling back to plain text covers both cases.
function hrefForNavigate(
  nav: NavApi,
  navigate: MetricNavigate,
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  const entityId =
    navigate.entityId !== undefined ? String(record[navigate.entityId] ?? "") : undefined;
  try {
    if (navigate.entity !== undefined) {
      return entityId === undefined || entityId === ""
        ? undefined
        : nav.hrefFor({ entity: navigate.entity, id: entityId });
    }
    if (navigate.screen !== undefined) {
      return nav.hrefFor({
        screenId: navigate.screen,
        ...(entityId !== undefined && entityId !== "" && { entityId }),
      });
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function buildSubtitleParts(
  parts: readonly RecordHeaderSubtitlePart[],
  record: Readonly<Record<string, unknown>>,
  nav: NavApi,
  appFeatures: readonly FeatureSchema[],
  userRoles: readonly string[] | undefined,
  host: ReturnHost | undefined,
): SubtitlePartView[] {
  return parts.flatMap((part): SubtitlePartView[] => {
    const field = typeof part === "string" ? part : part.field;
    const text = String(record[field] ?? "");
    if (text === "") return [];
    const navigate = typeof part === "string" ? undefined : part.navigate;
    if (navigate === undefined || !navigateTargetAllows(navigate, appFeatures, userRoles)) {
      return [{ field, text }];
    }
    const href = hrefForNavigate(nav, navigate, record);
    if (href === undefined) return [{ field, text }];
    return [{ field, text, href, onPress: () => runMetricNavigate(nav, navigate, record, host) }];
  });
}

function headerStatusTone(
  header: NonNullable<ProjectionDetailScreenDefinition["header"]>,
  record: Readonly<Record<string, unknown>>,
): StatusTone | undefined {
  if (header.status === undefined) return undefined;
  const value = String(record[header.statusToneField ?? header.status] ?? "");
  const declared =
    header.statusTones !== undefined && Object.hasOwn(header.statusTones, value)
      ? header.statusTones[value]
      : undefined;
  const declaredTone = declared !== undefined ? statusToneForOptionTone(declared) : undefined;
  return declaredTone ?? statusToneForValue(value);
}

function resolveSubtitleHref(
  header: ProjectionDetailScreenDefinition["header"],
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  if (header?.subtitleHref === undefined) return undefined;
  const value = record[header.subtitleHref];
  return typeof value === "string" && isAbsoluteHttpUrl(value) ? value : undefined;
}

// Projection-Detail-Body — read-only single-row inspector über eine explizite
// Query statt einer Entity (siehe projection-detail-shim.ts für die Schulden-
// Doku). Fetcht selbst über `screen.query` + `idParam` (analog zu
// EntityEditUpdateBody, das die Query-QN aus der Entity-Convention ableitet —
// hier ist die QN Author-explizit, wie bei ProjectionListBody). Rendert über
// RenderEdit MIT customSubmit-No-Op statt writeCommand: hasEditableSection()
// blendet den Save-Button aus (jedes Feld ist readOnly), und selbst ein
// natives Form-Submit (Enter-Keypress) würde ohne customSubmit gegen
// controller.submit() ohne submit-config throwen — der No-Op macht diesen
// Pfad harmlos statt ihn dem Zufall zu überlassen.
function ProjectionDetailBody({
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
  const {
    Banner,
    Button,
    Dialog,
    Text,
    Grid,
    GridCell,
    Card,
    Tabs,
    StatusBadge,
    Metric,
    MetricBand,
    PageHeader,
    Link,
    ActionOverflowMenu,
  } = usePrimitives();
  const t = useTranslation();
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompactContext = usePageHeaderCompact();
  const effectiveTranslate = translate ?? t;
  const nav = useNav();
  const idParam = screen.idParam ?? "id";
  // Singleton screens ignore whatever id the path happens to carry — the
  // server picks the row from session/context, so forwarding a path id
  // (even a stray/spoofed one) into the query or into extension sections'
  // entityId fallback (resolveExtensionEntityId in render-edit.tsx) would
  // let a client-controlled value leak where none is meant to reach.
  const effectiveEntityId = screen.singleton === true ? undefined : entityId;
  const isTabsMode = screen.layout.mode === "tabs";
  const activeSection = useMemo(() => {
    if (!isTabsMode || Tabs === undefined) return undefined;
    const tabParam = nav.searchParams["tab"];
    return (
      screen.layout.sections.find((section) => section.id === tabParam) ?? screen.layout.sections[0]
    );
  }, [isTabsMode, Tabs, screen.layout.sections, nav.searchParams]);
  const hasTabs = isTabsMode && Tabs !== undefined && activeSection !== undefined;
  // Tabs is an optional Core-Primitive: without it the screen falls back to
  // the stacked all-sections layout instead of silently truncating to section 1.
  useEffect(() => {
    if (isTabsMode && Tabs === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning for a setup error
      console.warn(
        `[kumiko] screen "${screen.id}" uses layout.mode: "tabs", but no <Tabs> primitive is registered — the tab strip will not render. createKumikoApp() from kumiko-renderer-web wires it automatically.`,
      );
    }
  }, [isTabsMode, Tabs, screen.id]);
  const entity = useMemo(() => synthesizeProjectionDetailEntity(screen.layout), [screen.layout]);
  const detailScreen = useMemo(() => {
    const source =
      activeSection !== undefined
        ? { ...screen, layout: { ...screen.layout, sections: [activeSection] } }
        : screen;
    return synthesizeProjectionDetailScreen(source);
  }, [screen, activeSection]);
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(
    screen.query,
    effectiveEntityId !== undefined ? { [idParam]: effectiveEntityId } : {},
  );

  // A writeForm section's handler creates a new record (see EditWriteFormSection's
  // doc) — both the outer record (header/metrics/other sections) and a sibling
  // relatedList section's own independently-fetched rows must reflect it. A
  // query refetch alone only refreshes `record` below; bumping this as
  // <RenderEdit>'s refreshToken makes RelatedListSection's own useQuery
  // re-run too (it has no `live` subscription of its own). Refetch instead of
  // remount (a `key`) so unsaved input in the other writeForm sections and
  // the related lists' local state survive.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadDetail = useCallback(async () => {
    await refetchAfterWrite(detailQuery.refetch);
    setReloadNonce((n) => n + 1);
  }, [detailQuery.refetch]);

  // Header actions render directly via RenderEditActionButton (fw#2713,
  // headerActions moved out of RenderEdit's footer) — this component owns
  // the failure-surfacing state RenderEdit used to own for them.
  const [actionError, setActionError] = useState<string | null>(null);

  // Default edit action (fw#2166): resolved cross-feature over ALL mounted
  // features, not just this feature's own schema — detailFor itself is
  // resolved cross-feature by the boot-validator (detail-screens.ts), and
  // the motivating case is a projectionDetail whose query belongs to one
  // feature while the entity's entityEdit screen lives in another. Unlike
  // useNavigateToCreateFor this must NOT filter on allowCreate/singleton —
  // those gate create-targets, we're resolving an update-target by a
  // known id.
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const dispatcher = useOptionalDispatcher();
  const clientActions = useClientActionRuntime();
  const host = useReturnHost();
  const returnTargetParam = useReturnTarget(screen.id);
  // A singleton has no record route to come back to — same as entityEdit.
  const returnTarget = screen.singleton === true ? undefined : returnTargetParam;
  const { drawerAction, drawerScreen, drawerInitialValues, openDrawer, closeDrawer } =
    useDrawerAction(schema);
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
  const editScreen = useMemo(() => {
    const detailFor = screen.detailFor;
    if (detailFor === undefined) return undefined;
    return findEditScreenFor(detailFor, appFeatures, userRoles);
  }, [appFeatures, screen.detailFor, userRoles]);
  const defaultEditAction = useMemo((): RenderEditAction | undefined => {
    if (editScreen === undefined) return undefined;
    // editScreen.id is registry-qualified ("feature:screen:contact-edit");
    // nav.navigate expects the short form (see useNavigateToCreateFor above).
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
        onWriteSuccess: detailQuery.refetch,
        onRecordLeft: handleRecordLeft,
        sameEntityScreenId,
        clientActions,
      }),
    [
      detailQuery.data,
      detailQuery.refetch,
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
  const headerActions = useMemo((): readonly RenderEditAction[] | undefined => {
    const declaredHasEdit = screen.actions?.some((a) => a.id === "edit") === true;
    const resolved = buildRecordActions({
      actions: screen.actions ?? [],
      record: detailQuery.data ?? {},
      translate: effectiveTranslate,
      nav,
      host,
      dispatcher,
      openDrawer,
      onWriteSuccess: detailQuery.refetch,
      onRecordLeft: handleRecordLeft,
      sameEntityScreenId,
      clientActions,
    });
    if (defaultEditAction === undefined || declaredHasEdit) return resolved;
    return [defaultEditAction, ...(resolved ?? [])];
  }, [
    screen.actions,
    defaultEditAction,
    effectiveTranslate,
    nav,
    host,
    dispatcher,
    clientActions,
    detailQuery.data,
    detailQuery.refetch,
    openDrawer,
    handleRecordLeft,
    sameEntityScreenId,
  ]);
  const hasHeader = screen.header !== undefined;
  const hasMetrics = screen.metrics !== undefined && screen.metrics.length > 0;
  // ?? [] rather than threading `headerActions !== undefined` through every
  // use below — an empty array is a safe no-op for .map/.length.
  const headerActionsList = headerActions ?? [];
  const hasHeaderActions = headerActionsList.length > 0;
  const hasHeaderCard = hasHeader || hasMetrics || hasHeaderActions;
  // A header card (metric band, status, actions) needs more room than the
  // 640px form column; screens with only a record title keep the narrow one.
  const widensScreenFormColumn =
    hasHeaderCard &&
    !hasTabs &&
    screenFillsHeight(screen) &&
    detailScreen.layout.width === undefined;
  const renderedDetailScreen = useMemo(
    () =>
      widensScreenFormColumn
        ? { ...detailScreen, layout: { ...detailScreen.layout, width: HEADER_CARD_DEFAULT_WIDTH } }
        : detailScreen,
    [detailScreen, widensScreenFormColumn],
  );

  if (effectiveEntityId === undefined && screen.singleton !== true) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-projection-detail-missing-id">
        Screen <Text variant="code">{screen.id}</Text> (projectionDetail) needs a row id in the path
        — open it from a row action.
      </Banner>
    );
  }
  if (detailQuery.loading && detailQuery.data === null) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (detailQuery.error) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-error">
        {dispatcherErrorText(detailQuery.error, effectiveTranslate)}
      </Banner>
    );
  }
  const record = detailQuery.data;
  if (!record) {
    const backListScreen =
      screen.listScreenId ??
      (screen.detailFor !== undefined
        ? findEntityListScreen(schema, screen.detailFor)?.id
        : undefined);
    return (
      <RecordNotFoundState
        translate={effectiveTranslate}
        {...((returnTarget !== undefined || backListScreen !== undefined) && {
          onBack: () =>
            navigateToReturnOr(nav, returnTarget, () => {
              if (backListScreen !== undefined) {
                nav.navigate({ screenId: lastSegment(backListScreen) });
              }
            }),
        })}
      />
    );
  }
  // Grouped into the head Card alongside title/status/metrics (fw#2713):
  // these are actions on the record the head shows, not on whichever tab is
  // open, so they must stay in place across tab switches instead of
  // trailing the active tab's content in the card footer.
  const headerActionsContent = hasHeaderActions && (
    <Grid columns="auto" testId="kumiko-screen-projection-detail-actions">
      <HeaderActionsBar
        actions={headerActionsList}
        Button={Button}
        Dialog={Dialog}
        ActionOverflowMenu={ActionOverflowMenu}
        onError={setActionError}
        {...(screen.primaryAction !== undefined && { preferredPrimaryId: screen.primaryAction })}
      />
    </Grid>
  );
  // Rendered as RenderEdit's headerRegion (not as JSX siblings before it) so
  // this shares the same page padding/width as the record's edit card below
  // it, instead of sitting flush against the screen edge (fw record-screen
  // header polish).
  const recordTitle =
    screen.recordTitleField !== undefined
      ? resolveRecordTitle(record[screen.recordTitleField])
      : undefined;
  const header = screen.header;
  const subtitleHref = resolveSubtitleHref(header, record);
  // Plain Text, not Heading — the Card title slot already renders as its own
  // heading element (h3); nesting another heading (h1) inside it is invalid HTML.
  const headerTitleSlot =
    header !== undefined ? (
      header.status !== undefined ? (
        <Grid columns="auto">
          <Text testId="kumiko-screen-projection-detail-title">
            {String(record[header.title] ?? "")}
          </Text>
          {StatusBadge !== undefined ? (
            <StatusBadge
              value={String(record[header.status] ?? "")}
              tone={headerStatusTone(header, record)}
              testId="kumiko-screen-projection-detail-status"
            />
          ) : (
            <Text testId="kumiko-screen-projection-detail-status">
              {String(record[header.status] ?? "")}
            </Text>
          )}
        </Grid>
      ) : (
        <Text testId="kumiko-screen-projection-detail-title">
          {String(record[header.title] ?? "")}
        </Text>
      )
    ) : undefined;
  const subtitleParts =
    header !== undefined && typeof header.subtitle === "object"
      ? buildSubtitleParts(header.subtitle, record, nav, appFeatures, userRoles, host)
      : undefined;
  const headerSubtitleSlot =
    subtitleParts !== undefined ? (
      subtitleParts.length > 0 ? (
        <Text testId="kumiko-screen-projection-detail-subtitle">
          {subtitleParts.map((part, index) => (
            <Fragment key={part.field}>
              {index > 0 && (
                <Text variant="muted" decorative>
                  {" · "}
                </Text>
              )}
              {part.href !== undefined ? (
                <Link
                  href={part.href}
                  {...(part.onPress !== undefined && { onPress: part.onPress })}
                  className="underline"
                  testId={`kumiko-screen-projection-detail-subtitle-${part.field}`}
                >
                  {part.text}
                </Link>
              ) : (
                <Text testId={`kumiko-screen-projection-detail-subtitle-${part.field}`}>
                  {part.text}
                </Text>
              )}
            </Fragment>
          ))}
        </Text>
      ) : undefined
    ) : typeof header?.subtitle === "string" ? (
      subtitleHref !== undefined ? (
        <Link href={subtitleHref} target="_blank" testId="kumiko-screen-projection-detail-subtitle">
          {String(record[header.subtitle] ?? "")}
        </Link>
      ) : (
        <Text variant="muted" testId="kumiko-screen-projection-detail-subtitle">
          {String(record[header.subtitle] ?? "")}
        </Text>
      )
    ) : undefined;
  // slots.header shares the header card with the actions (one card, actions
  // top right) instead of rendering as an unframed block above it.
  const metricItems = screen.metrics?.map((metric) => {
    const field = metricField(metric);
    const labelKey = metricLabelKey(metric, screen.fieldLabels);
    const label = labelKey !== undefined ? effectiveTranslate(labelKey) : field;
    const value = String(record[field] ?? "");
    const testId = `kumiko-screen-projection-detail-metric-${field}`;
    const navigate = metricNavigateSpec(metric);
    const onPress =
      navigate !== undefined && navigateTargetAllows(navigate, appFeatures, userRoles)
        ? () => runMetricNavigate(nav, navigate, record, host)
        : undefined;
    return Metric !== undefined ? (
      <Metric
        key={field}
        label={label}
        value={value}
        testId={testId}
        {...(onPress !== undefined && { onPress })}
      />
    ) : (
      <GridCell key={field}>
        <Text variant="small" testId={`${testId}-label`}>
          {label}
        </Text>
        <Text testId={`${testId}-value`}>{value}</Text>
      </GridCell>
    );
  });
  // Metrics are a dl band when the primitive exists; the old Grid stays as the fallback.
  const metricsBlock = (subtitle?: ReactNode, lead?: ReactNode): ReactNode =>
    MetricBand !== undefined ? (
      <MetricBand
        testId="kumiko-screen-projection-detail-metrics"
        subtitle={subtitle}
        {...(lead !== undefined && { lead })}
      >
        {metricItems}
      </MetricBand>
    ) : (
      <Grid columns={screen.metrics?.length ?? 1} testId="kumiko-screen-projection-detail-metrics">
        {metricItems}
      </Grid>
    );
  const usesPageHeaderSlot = pageHeaderSlotAvailable && PageHeader !== undefined;
  const pageHeaderCompact = pageHeaderCompactContext && usesPageHeaderSlot;
  // The phone shell header clips a long status mid-word, so on phones the badge
  // sits in the body instead of the shell header slot.
  const statusBadge =
    header?.status !== undefined && StatusBadge !== undefined ? (
      <StatusBadge
        value={String(record[header.status] ?? "")}
        tone={headerStatusTone(header, record)}
        testId="kumiko-screen-projection-detail-status"
      />
    ) : undefined;
  // Lives in the band's subtitle row so it shares the metrics' horizontal inset.
  const bandSubtitle =
    pageHeaderCompact && statusBadge !== undefined ? (
      <>
        <Grid columns="auto" testId="kumiko-screen-projection-detail-status-row">
          {statusBadge}
        </Grid>
        {headerSubtitleSlot}
      </>
    ) : (
      headerSubtitleSlot
    );
  const actionErrorBanner = actionError !== null && (
    <Banner variant="error" testId="render-edit-action-error">
      {actionError}
    </Banner>
  );
  const renderHeaderContent = (headerSlot: ReactNode | undefined): ReactNode => (
    <>
      {usesPageHeaderSlot ? (
        <>
          <PageHeader
            {...(header !== undefined && { title: String(record[header.title] ?? "") })}
            {...(header === undefined && recordTitle !== undefined && { title: recordTitle })}
            {...(!pageHeaderCompact && statusBadge !== undefined && { status: statusBadge })}
            {...(hasHeaderActions && {
              actions: (
                <Grid columns="auto" testId="kumiko-screen-projection-detail-actions">
                  <HeaderActionsBar
                    actions={headerActionsList}
                    Button={Button}
                    Dialog={Dialog}
                    ActionOverflowMenu={ActionOverflowMenu}
                    onError={setActionError}
                    collapseAfterPrimary
                    compact={pageHeaderCompact}
                    PageHeader={PageHeader}
                    {...(screen.primaryAction !== undefined && {
                      preferredPrimaryId: screen.primaryAction,
                    })}
                  />
                </Grid>
              ),
            })}
          />
          {/* The band owns the horizontal inset; the slot is its unstyled lead
              row so it lines up with the metrics below. */}
          {MetricBand === undefined && bandSubtitle}
          {MetricBand === undefined && headerSlot}
          {(hasMetrics || bandSubtitle !== undefined || headerSlot !== undefined) &&
            (MetricBand !== undefined || hasMetrics) &&
            metricsBlock(bandSubtitle, MetricBand !== undefined ? headerSlot : undefined)}
          {actionErrorBanner}
        </>
      ) : (
        (hasHeaderCard || headerSlot !== undefined || recordTitle !== undefined) && (
          <Card
            slots={{
              ...(headerTitleSlot !== undefined && { title: headerTitleSlot }),
              ...(headerTitleSlot === undefined &&
                recordTitle !== undefined && { title: recordTitle }),
              ...(headerSubtitleSlot !== undefined && { subtitle: headerSubtitleSlot }),
              ...(headerSlot !== undefined && { headerContent: headerSlot }),
              ...(hasHeaderActions && { headerActions: headerActionsContent }),
            }}
          >
            {hasMetrics && metricsBlock()}
            {actionErrorBanner}
          </Card>
        )
      )}
      {hasTabs && activeSection !== undefined && (
        <Tabs
          testId="kumiko-screen-projection-detail-tabs"
          items={screen.layout.sections.map((section) => {
            const countField = isWriteFormEditSection(section) ? undefined : section.countField;
            const countValue = countField !== undefined ? record[countField] : undefined;
            const count =
              typeof countValue === "number" && Number.isFinite(countValue)
                ? countValue
                : undefined;
            return {
              id: section.id ?? "",
              label: effectiveTranslate(section.title ?? section.id ?? ""),
              ...(count !== undefined && { count }),
            };
          })}
          activeId={activeSection.id ?? ""}
          onSelect={(id) => nav.setSearchParams({ tab: id })}
        />
      )}
    </>
  );
  return (
    <>
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
      <DrawerHost
        schema={schema}
        drawerAction={drawerAction}
        drawerScreen={drawerScreen}
        {...(drawerInitialValues !== undefined && { drawerInitialValues })}
        userRoles={userRoles}
        {...(translate !== undefined && { translate })}
        onClose={closeDrawer}
        onSuccess={() => {
          closeDrawer();
          void reloadDetail();
        }}
      />
    </>
  );
}
// ---- actionForm (Tier 2.7d) ----

type RedirectSpec = string | ActionFormRedirect | ActionFormSuccessLink;

function redirectScreenTarget(redirect: RedirectSpec): string {
  return typeof redirect === "string" ? redirect : redirect.screen;
}

// Same-entity detection for navigate defaults: only an entityEdit screen of the
// SAME entity may receive the current record's id (it opens in UPDATE mode, which
// is what the boot validator assumes). Searched across all features.
function isEntityEditScreenOfEntity(
  entity: string | undefined,
  targetScreen: string,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): boolean {
  if (entity === undefined) return false;
  return [schema, ...appFeatures].some((feature) =>
    feature.screens.some(
      (s) => s.type === "entityEdit" && s.entity === entity && lastSegment(s.id) === targetScreen,
    ),
  );
}

// Record-scoped targets (actionForm, secretMint) take the shown record's id; an
// entityEdit of ANOTHER entity must not, or it would open that entity's UPDATE
// mode on the wrong id instead of create.
function isEntityEditScreenOfOtherEntity(
  entity: string,
  targetScreen: string,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): boolean {
  return [schema, ...appFeatures].some((feature) =>
    feature.screens.some(
      (s) => s.type === "entityEdit" && s.entity !== entity && lastSegment(s.id) === targetScreen,
    ),
  );
}

// A qualified redirect names its feature, so the search space is THAT feature
// only — the current schema's own screens must not shadow it with a same
// short-id screen of another type. An unqualified redirect searches this
// schema first (own screen wins), then every mounted feature. A named feature
// that isn't mounted (no provider / isolated test) falls back to this schema.
function findRedirectTargetScreen(
  redirect: RedirectSpec,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): ScreenDefinition | undefined {
  const redirectScreen = redirectScreenTarget(redirect);
  const targetId = lastSegment(redirectScreen);
  const targetFeatureName = featureNameFromQualifiedScreenId(redirectScreen);
  const targetFeature =
    targetFeatureName !== undefined
      ? appFeatures.find((f) => f.featureName === targetFeatureName)
      : undefined;
  const searchSpace =
    targetFeature !== undefined
      ? targetFeature.screens
      : targetFeatureName === undefined
        ? [...schema.screens, ...appFeatures.flatMap((f) => f.screens)]
        : schema.screens;
  return searchSpace.find((s) => lastSegment(s.id) === targetId);
}

// A redirect to a record screen ("show the result") is a deliberate forward
// navigation and keeps precedence over returnTo.
function redirectTargetsRecord(
  redirect: RedirectSpec,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): boolean {
  const target = findRedirectTargetScreen(redirect, schema, appFeatures);
  return (
    target !== undefined && (target.type === "entityEdit" || target.type === "projectionDetail")
  );
}

// Type-guard form narrows `returnTarget` for the caller's subsequent
// navigateToReturn(nav, returnTarget) call.
function returnToWinsOverRedirect(
  returnTarget: ScreenTarget | undefined,
  redirect: string | ActionFormRedirect,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): returnTarget is ScreenTarget {
  return returnTarget !== undefined && !redirectTargetsRecord(redirect, schema, appFeatures);
}

// Resolves an object-form redirect to a nav target — shared by
// actionForm and entityEdit (create + update) so the id
// carries over identically regardless of which screen type triggered it.
// `carriesId` gates entityId on the TARGET screen type: a redirect to a
// list screen never gets an id attached, matching actionForm's original
// behavior. The id itself prefers the write-handler's success payload
// (`submittedData`) and falls back to `fallbackRecord` — the entityEdit
// update path's already-loaded record, or the create path's just-submitted
// form values — both of which carry fields (e.g. a parent FK) the CRUD
// write executor's success payload doesn't flatly expose.
function resolveRedirectTarget(
  redirect: RedirectSpec,
  submittedData: unknown,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
  fallbackRecord?: Readonly<Record<string, unknown>>,
): ResolvedRedirectTarget {
  const redirectScreen = redirectScreenTarget(redirect);
  const idField = typeof redirect === "string" ? "id" : (redirect.idFrom ?? "id");
  const targetId = lastSegment(redirectScreen);
  const target = findRedirectTargetScreen(redirect, schema, appFeatures);
  const carriesId =
    target !== undefined && (target.type === "entityEdit" || target.type === "projectionDetail");
  if (!carriesId) return { screenId: targetId, entityId: undefined, tab: undefined };
  const entityId =
    extractIdField(submittedData, idField) ??
    (fallbackRecord !== undefined ? extractIdField(fallbackRecord, idField) : undefined);
  return {
    screenId: targetId,
    entityId,
    tab: typeof redirect === "string" ? undefined : redirect.tab,
  };
}

type ResolvedRedirectTarget = {
  readonly screenId: string;
  readonly entityId: string | undefined;
  readonly tab: string | undefined;
};

function navigateToRedirectTarget(nav: NavApi, target: ResolvedRedirectTarget): void {
  const navTarget = {
    screenId: target.screenId,
    ...(target.entityId !== undefined && { entityId: target.entityId }),
  };
  if (target.tab === undefined) nav.navigate(navTarget);
  else nav.navigate(navTarget, { searchParams: { tab: target.tab } });
}

// Links of the success box. Targets resolve like `redirect`; a link whose target
// needs a record id (entityEdit, projectionDetail) but whose payload field holds
// no string id is dropped instead of navigating to an id-less record screen.
// A link without idFrom to a non-record screen always navigates id-less.
function resolveSuccessLinks(
  links: readonly ActionFormSuccessLink[] | undefined,
  data: unknown,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
  nav: NavApi,
  translate: Translate,
): readonly ResolvedSuccessLink[] {
  const resolved: ResolvedSuccessLink[] = [];
  (links ?? []).forEach((link, index) => {
    const target = resolveRedirectTarget(link, data, schema, appFeatures);
    if (target.entityId === undefined && redirectTargetsRecord(link, schema, appFeatures)) return;
    const navTarget = {
      screenId: target.screenId,
      ...(target.entityId !== undefined && { entityId: target.entityId }),
    };
    const options = target.tab === undefined ? undefined : { searchParams: { tab: target.tab } };
    resolved.push({
      key: String(index),
      label: translate(link.label),
      href: nav.hrefFor(navTarget, options),
      onPress: () => nav.navigate(navTarget, options),
    });
  });
  return resolved;
}

// Success navigation for a configured redirect — shared by entityEdit's
// save and writeHandler record actions. The string form navigates without an
// entityId; the object form resolves like actionForm's, with `record` as the
// fallback id source.
function navigateAfterRedirect(options: {
  readonly nav: NavApi;
  readonly schema: FeatureSchema;
  readonly appFeatures: readonly FeatureSchema[];
  readonly returnTarget: ScreenTarget | undefined;
  readonly redirect: string | ActionFormRedirect;
  readonly resultData: unknown;
  readonly record: Readonly<Record<string, unknown>>;
}): void {
  const { nav, schema, appFeatures, returnTarget, redirect, resultData, record } = options;
  if (returnToWinsOverRedirect(returnTarget, redirect, schema, appFeatures)) {
    navigateToReturn(nav, returnTarget);
    return;
  }
  if (typeof redirect === "string") {
    nav.navigate({ screenId: lastSegment(redirect) });
    return;
  }
  navigateToRedirectTarget(
    nav,
    resolveRedirectTarget(redirect, resultData, schema, appFeatures, record),
  );
}

// The update payload nests the saved projection under `data`; a changed
// parent FK lives there, not in the pre-edit `record`.
function overlayUpdatedProjection(
  record: Readonly<Record<string, unknown>>,
  resultData: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof resultData !== "object" || resultData === null) return record;
  const projection = propertyOf(resultData, "data");
  if (typeof projection !== "object" || projection === null) return record;
  return { ...record, ...projection };
}

// Action-Form-Body — non-CRUD Write-Handler-driven Form. Re-uses
// RenderEdit über synthetisierte EntityDefinition + EntityEditScreen-
// Definition (siehe action-form-shim.ts für die Schulden-Doku). Die
// Form-Mechanik (useForm, RenderEdit, DefaultInput, Banner, Submit-
// Button) ist identisch zu entityEdit, nur der Submit-Pfad wechselt
// vom CRUD-verb auf den Author-deklarierten handler-QN +
// payloadMode="values" (alle Form-Werte schicken statt nur Changes).
function ActionFormBody({
  schema,
  screen,
  translate,
  entityId,
  initialOverrides,
  onSuccess,
  onCancelOverride,
  onDirtyChange,
  submitLabelFallback,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ActionFormScreenDefinition;
  readonly translate?: Translate;
  /** Record id from the route path; the source of the `load` query's id. */
  readonly entityId?: string;
  /** Row-drawer usage (RowAction kind:"drawer", fw#2710): prefill extracted
   *  from the clicked row, applied on top of searchParams through the same
   *  renderableFields/sensitive gates (see mergeSearchParamsIntoInitial). */
  readonly initialOverrides?: Readonly<Record<string, unknown>>;
  /** Drawer-hosted usage (toolbarAction kind:"drawer", fw#2225): called
   *  instead of the redirect-based navigation on successful submit, so the
   *  host closes the drawer + refetches its list regardless of whether
   *  `screen.redirect` is set — a full-page redirect would navigate away
   *  from the list the drawer sits on top of. */
  readonly onSuccess?: () => void;
  /** Drawer-hosted usage: replaces the cancelTarget/redirect-based Cancel
   *  handler so Cancel closes the drawer instead of navigating. */
  readonly onCancelOverride?: () => void;
  /** Drawer-hosted usage: reports unsaved input so the host can confirm
   *  before discarding it. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Drawer-hosted usage: submit label when the screen declares none (the opening action's label). */
  readonly submitLabelFallback?: string;
}): ReactNode {
  const nav = useNav();
  const appFeatures = useAppFeatures();
  const insideDrawer = useInsideDrawer();
  const locale = useLocale().locale();
  const { Banner } = usePrimitives();
  // Unused when drawer-hosted — onSuccess/onCancelOverride win below first.
  const returnTarget = useReturnTarget(screen.id);
  const submittableFields = useMemo(() => actionFormSubmittableFields(screen), [screen]);
  const synthEntity = useMemo(
    () => synthesizeActionFormEntity(submittableFields),
    [submittableFields],
  );
  const synthScreen = useMemo(() => synthesizeActionFormScreen(screen), [screen]);
  const pendingHandoff = useInitialValuesHandoff(screen.id);
  // A drawer-hosted form is not a navigation target, so it never takes a handoff.
  const handoffValues = onSuccess === undefined ? pendingHandoff : undefined;
  // This screen has no entity, so a money field here declares its own currency
  // source (fw#2839, boot-enforced) — without one the form would seed a bare
  // `0` the handler's schema rejects. When a tenant-declared field's config
  // query errors or holds no value there is no entity default to use, and
  // submitting a guessed currency would mis-book the amount — block instead.
  const tenantCurrencyFieldNames = useMemo(
    () => tenantCurrencyMoneyFieldNames(screen.fields),
    [screen.fields],
  );
  const {
    overrides: moneyCurrencyOverrides,
    loading: currencyLoading,
    unresolved: currencyUnresolved,
  } = useMoneyCurrencyOverrides(screen.fields, tenantCurrencyFieldNames, undefined);
  const loadableFieldNames = useMemo(
    () =>
      Object.entries(submittableFields)
        .filter(([, field]) => !isSecretFormField(field))
        .map(([name]) => name),
    [submittableFields],
  );
  const loadState = useActionFormLoad(
    screen.load,
    screen.load !== undefined
      ? resolveActionFormRecordId({
          routeEntityId: entityId,
          drawerOverrides: initialOverrides,
          searchParams: nav.searchParams,
        })
      : undefined,
    loadableFieldNames,
  );
  const loadedValues = loadState?.status === "ready" ? loadState.values : undefined;
  const initial = useMemo(() => {
    // With `load` the loaded record is the only source of values: a crafted link
    // or a row's params must not seed fields the record would otherwise own.
    const prefillSources =
      screen.load !== undefined
        ? { searchParams: {}, urlPrefillFields: undefined }
        : {
            searchParams: nav.searchParams,
            urlPrefillFields: screen.urlPrefillFields,
            ...(initialOverrides !== undefined && { drawerOverrides: initialOverrides }),
            ...(handoffValues !== undefined && { handoffValues }),
          };
    return {
      ...mergeSearchParamsIntoInitial(submittableFields, {
        ...prefillSources,
        renderableFields: layoutFieldNames(synthScreen),
        ...(moneyCurrencyOverrides !== undefined && { moneyCurrencyOverrides }),
      }),
      ...loadedValues,
    };
  }, [
    submittableFields,
    screen.load,
    screen.urlPrefillFields,
    nav.searchParams,
    synthScreen,
    moneyCurrencyOverrides,
    initialOverrides,
    handoffValues,
    loadedValues,
  ]);
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const summary = useMemo(
    () => resolveActionFormSummary(screen.summary, initialOverrides, effectiveTranslate, locale),
    [screen.summary, initialOverrides, effectiveTranslate, locale],
  );
  const dispatcher = useDispatcher();
  const [success, setSuccess] = useState<ActionFormSuccessState | undefined>(undefined);
  // Bumped after a successful submit with resetOnSuccess: remounts RenderEdit, which
  // re-seeds the form from `initial` (prefill kept, typed values cleared).
  const [formEpoch, setFormEpoch] = useState(0);
  // A slow label lookup of an earlier submit must not overwrite the banner of a later one.
  const successSequence = useRef(0);
  useEffect(
    () => () => {
      successSequence.current += 1;
    },
    [],
  );
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>, values: FormValues) => {
      successSequence.current += 1;
      const sequence = successSequence.current;
      setSuccess(undefined);
      if (!result.isSuccess) return;
      if (onSuccess !== undefined) {
        onSuccess();
        return;
      }
      if (screen.redirect === undefined) {
        const hasSuccessLinks = (screen.successLinks?.length ?? 0) > 0;
        const publish = (text: string): void => {
          if (successSequence.current !== sequence) return;
          setSuccess({
            text,
            links: resolveSuccessLinks(
              screen.successLinks,
              result.data,
              schema,
              appFeatures,
              nav,
              effectiveTranslate,
            ),
          });
        };
        const messageKey = screen.successMessage;
        if (messageKey !== undefined) {
          const show = (params: Record<string, string>): void =>
            publish(effectiveTranslate(messageKey, params));
          void resolveSuccessMessageParams(screen, schema.featureName, values, dispatcher, locale)
            .then(show)
            .catch(() => show(formatSummaryParams(values, locale)));
        } else if (hasSuccessLinks || screen.resetOnSuccess === true) {
          publish(effectiveTranslate("kumiko.actionForm.success"));
        }
        if (screen.resetOnSuccess === true) setFormEpoch((epoch) => epoch + 1);
      }
      // Without a redirect the form stays put; returnTo only replaces an existing
      // navigation, and never one to a record screen (see redirectTargetsRecord).
      if (screen.redirect !== undefined) {
        if (returnToWinsOverRedirect(returnTarget, screen.redirect, schema, appFeatures)) {
          navigateToReturn(nav, returnTarget);
        } else {
          navigateToRedirectTarget(
            nav,
            resolveRedirectTarget(screen.redirect, result.data, schema, appFeatures),
          );
        }
      }
    },
    [
      nav,
      screen,
      onSuccess,
      schema,
      appFeatures,
      returnTarget,
      dispatcher,
      locale,
      effectiveTranslate,
    ],
  );
  // The success box disappears with the next edit; a submit clears it itself.
  const handleDirtyChange = useCallback(
    (dirty: boolean) => {
      if (dirty) {
        successSequence.current += 1;
        setSuccess(undefined);
      }
      onDirtyChange?.(dirty);
    },
    [onDirtyChange],
  );
  // Cancel ist nur sinnvoll wenn ein Navigations-Ziel existiert —
  // sonst hätte der Button nirgendwo hin zu navigieren. cancelTarget
  // gewinnt über redirect; `false` schaltet den Button explizit ab
  // (Single-Action-Screens, wo Cancel nur Submit-ohne-Senden wäre).
  // returnTo wins over the declared target when both are present.
  const handleCancel = useMemo<(() => void) | undefined>(() => {
    if (onCancelOverride !== undefined) return onCancelOverride;
    const target =
      screen.cancelTarget ??
      (screen.redirect !== undefined ? redirectScreenTarget(screen.redirect) : undefined);
    if (target === undefined || target === false) return undefined;
    return () =>
      navigateToReturnOr(nav, returnTarget, () => nav.navigate({ screenId: lastSegment(target) }));
  }, [nav, screen.redirect, screen.cancelTarget, onCancelOverride, returnTarget]);
  // Rendering the form before a tenant-declared currency lands would show the
  // fallback and, on a fast click, submit it (fw#2933) — hold instead.
  if (currencyLoading) {
    return (
      <Banner padded variant="loading" testId="kumiko-screen-loading">
        Loading…
      </Banner>
    );
  }
  if (currencyUnresolved) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-currency-unresolved">
        The tenant currency could not be loaded, so this form cannot be submitted.
      </Banner>
    );
  }
  if (loadState !== undefined && loadState.status !== "ready") {
    return (
      <ActionFormLoadStatus state={loadState} screenId={screen.id} translate={effectiveTranslate} />
    );
  }
  return (
    <RenderEdit
      key={formEpoch}
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={initial}
      // Extension-Sections im actionForm sehen die initialen Form-Values
      // (inkl. searchParams-Prefill, z.B. ?incidentId=…) als initialValues
      // — anders als im entityEdit gibt es hier keinen record, aus dem
      // sie Kontext ziehen könnten.
      extensionInitialValues={initial}
      {...(screen.submitPrefilled === true && {
        submitWithoutChanges: hiddenRequiredFieldsFilled(synthScreen, screen.fields, initial),
      })}
      {...(success !== undefined && {
        leadContent: <ActionFormSuccessBanner success={success} />,
      })}
      writeCommand={screen.handler}
      payloadMode="values"
      onSubmit={handleSubmitted}
      {...(handleCancel !== undefined && { onCancel: handleCancel })}
      onDirtyChange={handleDirtyChange}
      {...((insideDrawer || screenFillsHeight(screen)) && { fillScreenHeight: true })}
      {...((screen.submitLabel ?? submitLabelFallback) !== undefined && {
        submitLabel: screen.submitLabel ?? submitLabelFallback,
      })}
      {...(screen.submitStyle !== undefined && { submitVariant: screen.submitStyle })}
      {...(screen.footerActions !== undefined && { footerActions: screen.footerActions })}
      {...(summary !== undefined && { summary })}
      {...(translate !== undefined && { translate })}
    />
  );
}

// ---- config-edit ----
//
// Settings-Form gegen das bundled config-Feature. Liest beim Mount
// `config:query:values` (returned ALLE Keys die der User lesen darf
// als `{ [qualifiedKey]: { value, scope } }`); schreibt beim Save
// pro geändertem Feld einen `config:write:set` Call. Singleton-pro-
// Tenant kommt by-design vom config-feature (key+tenantId Unique-
// Constraint) — kein Bridge-Hack, keine extra Aggregate.
//
// Parallel-Aufbau zu ActionFormBody: synthesisierte Entity + EntityEdit-
// Screen damit RenderEdit reused werden kann; Layout/Field-Rendering/
// Banner/Submit-Button-State sind identisch zu entityEdit. Der einzige
// Pfad-Unterschied ist customSubmit das mehrere config:write:set-Calls
// orchestriert.
//
// Response enthält seit config-seeding auch `source` (z.B. "system-row")
// für das ConfigSourceBadge. Type wird lokal gehalten da er nur hier
// relevant ist — kein eigener Export nötig.
type ConfigValueResponse = Readonly<
  Record<string, { value: string | number | boolean | undefined; scope: string; source: string }>
>;

// A money-typed config-edit field renders through RenderField's entityEdit
// `{amount, currency}` payload shape (render-field.tsx, #1923), but
// `ConfigKeyType` (write-helpers.ts validateType) only ever knows
// number/boolean/text/select — a config value is always a bare scalar.
// Unwrap back to the amount before it hits config:write:set.
function unwrapMoneyValue(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "amount" in value) {
    const amount = value.amount;
    if (typeof amount === "number") return amount;
  }
  return value;
}

const CONFIG_SCOPE_SOURCE = {
  user: "user-row",
  tenant: "tenant-row",
  system: "system-row",
} as const satisfies Record<ConfigScope, ConfigCascadeLevel["source"]>;

function isWriteOnlyTextField(
  fieldDef: ConfigEditScreenDefinition["fields"][string] | undefined,
): boolean {
  return fieldDef?.type === "text" && fieldDef.writeOnly === true;
}

function hasStoredValue(stored: unknown): boolean {
  return stored !== undefined && stored !== null && stored !== "";
}

const CONFIG_WRITE_ISSUE_PATH = "value";

// write-helpers report every issue at `value`; in a batch that path is
// meaningless to the form, so point it at the field whose command failed.
function mapFailedConfigCommandIssuesToField(
  error: DispatcherError,
  failedIndex: number,
  commandFieldNames: readonly string[],
): DispatcherError {
  const fieldName = commandFieldNames[failedIndex];
  const fields = error.details?.fields;
  if (fieldName === undefined || fields === undefined) return error;
  return {
    ...error,
    details: {
      ...error.details,
      fields: fields.map((issue) => {
        if (issue.path === CONFIG_WRITE_ISSUE_PATH) return { ...issue, path: fieldName };
        if (issue.path.startsWith(`${CONFIG_WRITE_ISSUE_PATH}.`)) {
          return {
            ...issue,
            path: `${fieldName}${issue.path.slice(CONFIG_WRITE_ISSUE_PATH.length)}`,
          };
        }
        return issue;
      }),
    },
  };
}

// A money field without a declared default starts empty too (buildInitialValues
// maps it to 0, which a save would persist as a deliberate "0" override); numbers
// are handled there, except a required one, which config fields never are.
function buildConfigEditDefaults(
  fields: ConfigEditScreenDefinition["fields"],
): Record<string, unknown> {
  const defaults = buildInitialValues(fields) as Record<string, unknown>; // @cast-boundary render-helper
  for (const [shortName, fieldDef] of Object.entries(fields)) {
    const { type, default: fieldDefault } = fieldDef as { type?: string; default?: unknown }; // @cast-boundary schema-walk
    if ((type === "number" || type === "money") && fieldDefault === undefined) {
      defaults[shortName] = undefined;
    }
  }
  return defaults;
}

type StoredSecretRow = { readonly key: string };

// A field hidden by its `visible` condition (a provider's settings while another
// provider is picked) is not saved: the form saves what it shows.
function hiddenLayoutFieldNames(
  screen: EntityEditScreenDefinition,
  values: Readonly<Record<string, unknown>>,
): ReadonlySet<string> {
  return new Set(
    layoutEditFields(screen)
      .filter((spec) => spec.visible !== undefined && !evalFieldCondition(spec.visible, values))
      .map((spec) => spec.field),
  );
}

function isEmptyNumericFormValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return typeof value === "number" && !Number.isFinite(value);
}

function ConfigEditBody({
  schema,
  screen,
  translate,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ConfigEditScreenDefinition;
  readonly translate?: Translate;
}): ReactNode {
  const { ConfigCascadeView } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const dispatcher = useDispatcher();

  // Detail-Load: config:query:values returnt ALLE Keys des Tenants.
  // Wir mappen via screen.configKeys von short → qualified-name auf
  // unsere Form-Field-Werte.
  const valuesQuery = useQuery<ConfigValueResponse>("config:query:values", {});

  const cascadeQuery = useQuery<Record<string, ConfigCascade>>("config:query:cascade", {});

  const secretKeys = screen.secretKeys;
  const secretsQuery = useQuery<readonly StoredSecretRow[]>(
    "secrets:query:list",
    {},
    { enabled: secretKeys !== undefined },
  );

  const synthEntity = useMemo(() => synthesizeConfigEditEntity(screen.fields), [screen.fields]);
  const synthScreen = useMemo(() => synthesizeConfigEditScreen(screen), [screen]);
  const boundsSchema = useMemo(() => buildConfigEditSchema(screen.fields), [screen.fields]);

  // Initial-Values: pro Field-Name den Wert aus `values[qualifiedKey]`
  // abholen. Fehlt der Key auf dem Server (= noch nie gesetzt), nutzen
  // wir den Field-Default (createTextField/createNumberField/...).
  // String-coerce nur für Text-Fields; andere Types sollten in der
  // Response bereits Native-Type sein.
  const initial = useMemo<FormValues | null>(() => {
    if (valuesQuery.data === null) return null;
    if (secretKeys !== undefined && secretsQuery.data === null) return null;
    const storedSecretKeys = new Set((secretsQuery.data ?? []).map((row) => row.key));
    const out: Record<string, unknown> = {};
    const defaults = buildConfigEditDefaults(screen.fields);
    for (const [shortName, fieldDef] of Object.entries(screen.fields)) {
      const secretKey = secretKeys?.[shortName];
      if (secretKey !== undefined) {
        out[shortName] = storedSecretKeys.has(secretKey) ? true : null;
        continue;
      }
      const qualified = screen.configKeys[shortName];
      if (qualified === undefined) {
        // Author hat ein Field deklariert ohne Mapping — nimm Default.
        // Boot-Validator pinnt das, sollte nie zur Runtime greifen.
        out[shortName] = defaults[shortName];
        continue;
      }
      const stored = valuesQuery.data[qualified]?.value;
      // The read carries a mask (or nothing); only whether a value exists is
      // meaningful, so the field gets the writeOnly wire shape true / null.
      // The read is the effective value: an inherited one is not "set" on this
      // scope, and a reset here would remove nothing.
      if (isWriteOnlyTextField(fieldDef)) {
        const ownedByThisScope =
          valuesQuery.data[qualified]?.source === CONFIG_SCOPE_SOURCE[screen.scope];
        out[shortName] = ownedByThisScope && hasStoredValue(stored) ? true : null;
        continue;
      }
      if (stored === undefined) {
        out[shortName] = defaults[shortName];
        continue;
      }
      const ftype = propertyOf(fieldDef, "type");
      // Field-Type-Coercion: config-Werte sind string|number|boolean,
      // aber der Form-State erwartet das passende Field-Native-Type.
      if (ftype === "number" || ftype === "money") {
        out[shortName] = typeof stored === "number" ? stored : Number(stored);
      } else if (ftype === "boolean") {
        out[shortName] = typeof stored === "boolean" ? stored : stored === "true";
      } else {
        out[shortName] = typeof stored === "string" ? stored : String(stored);
      }
    }
    return out;
  }, [
    valuesQuery.data,
    secretsQuery.data,
    secretKeys,
    screen.fields,
    screen.configKeys,
    screen.scope,
  ]);

  // Cascade-Lookup: qualifiedKey → ConfigCascade für die
  // Cascade-Anzeige unter jedem Feld. Defensive `levels`-Shape-Check
  // damit fremde Query-Mocks (z.B. configEdit-Unit-Tests die nur
  // `config:query:values` mocken) nicht durch das Cascade-Rendering
  // crashen.
  const cascades = useMemo<Record<string, ConfigCascade>>(() => {
    if (!cascadeQuery.data) return {};
    const out: Record<string, ConfigCascade> = {};
    for (const [shortName, qualified] of Object.entries(screen.configKeys)) {
      const cascade = cascadeQuery.data[qualified];
      if (cascade && Array.isArray(cascade.levels)) out[shortName] = cascade;
    }
    return out;
  }, [cascadeQuery.data, screen.configKeys]);

  // Multi-Write Submit: ein einzelner /api/batch Call mit N
  // config:write:set Commands. Server-side ist batch atomic
  // (transaktional: alle Writes in einer DB-TX, all-or-nothing) und
  // browser-side ist es genau eine HTTP-Roundtrip — kein Race zwischen
  // mehreren in-flight fetches die der Browser bei page.reload mid-
  // submit aborten könnte. Promise.all von N separaten dispatcher.write-
  // Calls war fragil: server bekommt + commited alle N, aber das
  // Browser-Connection-Pool gibt sporadisch "Failed to fetch" für
  // einzelne Responses zurück, customSubmit returnt failure obwohl der
  // Write durch ist, das Form bleibt dirty.
  const customSubmit = useCallback(
    async (snapshot: FormSnapshot<FormValues>): Promise<SubmitResult<unknown>> => {
      const commands: Command[] = [];
      const commandFieldNames: string[] = [];
      const hiddenFieldNames = hiddenLayoutFieldNames(synthScreen, snapshot.values);
      for (const [shortName, value] of Object.entries(snapshot.changes)) {
        if (hiddenFieldNames.has(shortName)) continue;
        const secretKey = secretKeys?.[shortName];
        if (secretKey !== undefined) {
          // Same wire shape as a writeOnly config field: null removes, a string replaces.
          if (value === null) {
            commandFieldNames.push(shortName);
            commands.push({ type: "secrets:write:delete", payload: { key: secretKey } });
          } else if (typeof value === "string" && value.trim() !== "") {
            commandFieldNames.push(shortName);
            commands.push({ type: "secrets:write:set", payload: { key: secretKey, value } });
          }
          continue;
        }
        const qualified = screen.configKeys[shortName];
        if (qualified === undefined) continue;
        const fieldDef = screen.fields[shortName] as // @cast-boundary schema-walk
          | { type?: string; optionsQuery?: string }
          | undefined;
        const ftype = fieldDef?.type;
        if (isWriteOnlyTextField(screen.fields[shortName])) {
          // true (untouched/undone) and "" mean keep the stored secret; null removes it.
          if (value === null) {
            commandFieldNames.push(shortName);
            commands.push({
              type: "config:write:reset",
              payload: { key: qualified, scope: screen.scope },
            });
          } else if (typeof value === "string" && value !== "") {
            commandFieldNames.push(shortName);
            commands.push({
              type: "config:write:set",
              payload: { key: qualified, value, scope: screen.scope },
            });
          }
          continue;
        }
        // A query-backed select is cleared to "" when its dependent value became
        // invalid. config:write:set would store that as an empty override (the
        // badge shows "Mandant" with no value); reset falls back to the inherited
        // value. set can't do it: deleting the row is irreversible, reset is
        // the high-risk handler.
        if (ftype === "select" && fieldDef?.optionsQuery !== undefined && value === "") {
          commandFieldNames.push(shortName);
          commands.push({
            type: "config:write:reset",
            payload: { key: qualified, scope: screen.scope },
          });
          continue;
        }
        // Cleared number/money: drop this scope's override instead of storing an empty value.
        if (
          (ftype === "number" || ftype === "money") &&
          isEmptyNumericFormValue(ftype === "money" ? unwrapMoneyValue(value) : value)
        ) {
          commandFieldNames.push(shortName);
          commands.push({
            type: "config:write:reset",
            payload: { key: qualified, scope: screen.scope },
          });
          continue;
        }
        commandFieldNames.push(shortName);
        commands.push({
          type: "config:write:set",
          payload: {
            key: qualified,
            value: ftype === "money" ? unwrapMoneyValue(value) : value,
            scope: screen.scope,
          },
        });
      }
      if (commands.length === 0) {
        return { validationBlocked: false, isSuccess: true, data: undefined };
      }
      const result = await dispatcher.batch(commands);
      if (!result.isSuccess) {
        return {
          validationBlocked: false,
          isSuccess: false,
          error: mapFailedConfigCommandIssuesToField(
            result.error,
            result.failedIndex,
            commandFieldNames,
          ),
        };
      }
      // Cascade-Disclosure + Maskenwerte nach dem Write nachziehen, sonst
      // bleibt die Anzeige stale bis Reload — gleiche refetch-Calls wie onReset.
      // allSettled: der Write ist schon committed, ein gescheitertes Refetch
      // (stale Anzeige) darf das Erfolgsergebnis nicht in einen Fehler kippen.
      await Promise.allSettled([
        valuesQuery.refetch?.(),
        cascadeQuery.refetch?.(),
        ...(secretKeys !== undefined ? [secretsQuery.refetch?.()] : []),
      ]);
      return { validationBlocked: false, isSuccess: true, data: undefined };
    },
    [
      dispatcher,
      synthScreen,
      secretKeys,
      screen.configKeys,
      screen.fields,
      screen.scope,
      valuesQuery.refetch,
      cascadeQuery.refetch,
      secretsQuery.refetch,
    ],
  );

  if (valuesQuery.loading && valuesQuery.data === null) return <QueryLoadingBanner />;
  const failedQuery = valuesQuery.error ? valuesQuery : secretsQuery.error ? secretsQuery : null;
  if (failedQuery?.error) {
    return (
      <QueryErrorBanner
        error={failedQuery.error}
        translate={effectiveTranslate}
        onRetry={failedQuery.refetch}
      />
    );
  }
  if (initial === null) return <QueryLoadingBanner />;
  // Cascade values of a select show the option label the select itself shows,
  // not the stored value (a UUID for optionsQuery selects).
  const cascadeValueRenderer = (
    fieldName: string,
  ): ((value: string | number | boolean) => ReactNode) | undefined => {
    const fieldDef = screen.fields[fieldName];
    if (fieldDef?.type !== "select") return undefined;
    if (fieldDef.optionsQuery !== undefined) {
      const query = fieldDef.optionsQuery;
      const payload = resolveOptionsQueryPayload(fieldDef.optionsQueryPayload ?? {}, initial);
      return (value) => <QueryOptionLabel query={query} payload={payload} value={value} />;
    }
    if (fieldDef.options.length === 0) return undefined;
    return (value) =>
      buildOptionLabels(
        effectiveTranslate,
        (option) => fieldOptionLabelKey(schema.featureName, synthScreen.entity, fieldName, option),
        [String(value)],
      )[String(value)];
  };
  return (
    <RenderEdit
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={initial}
      schema={boundsSchema}
      customSubmit={customSubmit}
      dirtyFooter
      validateOnChange
      {...(screenFillsHeight(screen) && { fillScreenHeight: true })}
      {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
      {...(translate !== undefined && { translate })}
      fieldAppendixPlacement="below-control"
      fieldAccent={(fieldName: string) =>
        cascades[fieldName]?.levels.find((level) => level.isActive)?.source ===
        CONFIG_SCOPE_SOURCE[screen.scope]
      }
      markChangedFields
      {...(screen.fieldDescriptions !== undefined && {
        fieldDescription: (fieldName: string) => {
          const key = screen.fieldDescriptions?.[fieldName];
          return key === undefined ? undefined : effectiveTranslate(key);
        },
      })}
      fieldAppendix={(fieldName: string) => {
        const cascade = cascades[fieldName];
        if (cascade === undefined) return undefined;
        const renderValue = cascadeValueRenderer(fieldName);
        return (
          <ConfigCascadeView
            cascade={cascade}
            screenScope={screen.scope}
            qualifiedKey={screen.configKeys[fieldName]}
            required={screen.requiredFields?.includes(fieldName) ?? false}
            {...(renderValue !== undefined && { renderValue })}
            onReset={async (key, scope) => {
              await dispatcher.write("config:write:reset", { key, scope });
              await Promise.allSettled([valuesQuery.refetch?.(), cascadeQuery.refetch?.()]);
            }}
          />
        );
      }}
    />
  );
}

// Re-export the ScreenDefinition type so callers don't reach into
// framework/ui-types for a prop-type they need to narrow on.
export type { ScreenDefinition };
