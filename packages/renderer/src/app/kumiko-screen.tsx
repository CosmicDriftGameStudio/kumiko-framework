import type {
  DashboardScreenDefinition,
  ScreenDefinition,
  ScreenVisibility,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { useUserRoles } from "../context/user-roles-context.tsx";
import type { ListRowViewModel, Translate } from "../headless/index.ts";
import { useQuery } from "../hooks/use-query.ts";
import { useTranslation } from "../i18n.tsx";
import { PageHeaderSlotAvailableProvider } from "../page-header-slot.ts";
import { usePrimitives } from "../primitives.tsx";
import { ActionFormBody } from "./action-form-body.tsx";
import { ConfigEditBody } from "./config-edit-body.tsx";
import { useCustomScreenComponent } from "./custom-screens.tsx";
import { useDashboardBody } from "./dashboard-body.tsx";
import { EntityEditScreen } from "./entity-edit-screen.tsx";
import { EntityListScreen } from "./entity-list-screen.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { LockedHeaderScope, StandInChainBoundary } from "./locked-screen-header.tsx";
import { ProjectionDetailBody } from "./projection-detail-body.tsx";
import { ProjectionListBody } from "./projection-list-body.tsx";
import { lastSegment } from "./qn.ts";
import { qualifyScreenId } from "./qualify-screen-id.ts";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { type ReturnHost, ReturnHostProvider, useReturnHost } from "./return-to.tsx";
import { screenAccessAllows } from "./screen-access.ts";
import { ScreenAccessDeniedBanner, ScreenMissingState } from "./screen-shared.tsx";
import { SecretMintBody } from "./secret-mint-body.tsx";
import { SecretsEditBody } from "./secrets-edit-body.tsx";
import { useEmbeddedScreen } from "./use-embedded-screen.ts";
import { evalVisibleWhenAfterShown } from "./visible-when.ts";

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
  // Copy-link action for entityEdit update screens. The default implementation
  // is provided by createKumikoApp/RoutedScreen; this platform-neutral package
  // does not build URLs or call the clipboard (guard-renderer-boundaries).
  // Visible only in update mode (entityId must be set).
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
        key={entityId}
        entityId={entityId}
        featureName={schema.featureName}
        visibleWhen={screen.visibleWhen}
        fallback={screen.fallback}
        translate={translate}
      >
        <StandInChainBoundary>{screenBody}</StandInChainBoundary>
      </ScreenVisibilityGate>
    ) : (
      <StandInChainBoundary>{screenBody}</StandInChainBoundary>
    );
  // An embedded screen (e.g. a dashboard panel) keeps its parent's host and
  // must not portal its page header into the shell that hosts the outer screen.
  if (outerHost !== undefined) {
    return <PageHeaderSlotAvailableProvider value={false}>{body}</PageHeaderSlotAvailableProvider>;
  }
  return <ReturnHostProvider value={ownHost}>{body}</ReturnHostProvider>;
}

function ScreenVisibilityGate({
  entityId,
  featureName,
  visibleWhen,
  fallback,
  translate,
  children,
}: {
  readonly entityId: string | undefined;
  readonly featureName: string;
  readonly visibleWhen: ScreenVisibility;
  readonly fallback: string | undefined;
  readonly translate?: Translate;
  readonly children: ReactNode;
}): ReactNode {
  // An idParam gate without a route id has nothing to ask: treated as hidden, never queried.
  const missingRouteId = visibleWhen.idParam !== undefined && entityId === undefined;
  const result = useQuery<Readonly<Record<string, unknown>>>(
    visibleWhen.query,
    visibleWhen.idParam !== undefined && entityId !== undefined
      ? { [visibleWhen.idParam]: entityId }
      : {},
    { live: true, enabled: !missingRouteId },
  );
  const wasShown = useRef(false);
  const verdict = missingRouteId
    ? "hidden"
    : evalVisibleWhenAfterShown(visibleWhen, result, wasShown.current);
  useEffect(() => {
    if (verdict === "visible") wasShown.current = true;
  }, [verdict]);
  if (verdict === "visible") return children;
  if (verdict === "loading") {
    return <QueryLoadingBanner />;
  }
  if (fallback !== undefined) {
    return (
      <FallbackScreen
        featureName={featureName}
        fallback={fallback}
        translate={translate}
        {...(visibleWhen.idParam !== undefined && entityId !== undefined && { entityId })}
      />
    );
  }
  return (
    <>
      <LockedHeaderScope />
      <ScreenUnavailableBanner />
    </>
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
  entityId,
}: {
  readonly entityId?: string;
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
        <LockedHeaderScope />
        <ScreenUnavailableBanner />
      </>
    );
  }
  return (
    <LockedHeaderScope standInScreenId={lastSegment(target.qn)}>
      <KumikoScreen
        schema={target.schema}
        qn={target.qn}
        translate={translate}
        {...(entityId !== undefined && { entityId })}
      />
    </LockedHeaderScope>
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
        // the screen briefly shows the PREVIOUS record's fields.
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

// The dashboard panel implementation (StatCard, charts) is platform-specific and
// comes from the DashboardBody context; renderer/web registers the web
// implementation in createKumikoApp.
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
        Dashboard screen <Text variant="code">{screen.id}</Text> — no dashboard body registered
        (createKumikoApp from <Text variant="code">kumiko-renderer/web</Text> wires it
        automatically).
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

// Looks up the component from the CustomScreens context, populated by
// clientFeatures.components in createKumikoApp. If no provider is mounted or
// the screenId is unregistered, an error banner is rendered instead of an
// empty screen. The screen remains reachable by URL when the server feature is
// mounted, even without a client plugin.
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

// Re-export the ScreenDefinition type so callers don't reach into
// framework/ui-types for a prop-type they need to narrow on.
export type { ScreenDefinition };
