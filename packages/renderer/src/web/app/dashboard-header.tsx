import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { type ErrorNotice, ErrorReference } from "../../app/error-reference.tsx";
import type { DispatcherError, Translate } from "../../headless/index.ts";
import {
  dispatcherErrorText,
  HeaderActionsBar,
  type usePrimitives,
  type useRecordActions,
} from "../../index.ts";
import { StatusBadge } from "../widgets/status-badge.tsx";
import type { useDashboardFormats, useLoadedAt } from "./dashboard-shared.tsx";

type Primitives = ReturnType<typeof usePrimitives>;

export type DashboardHeaderModel = {
  readonly screen: DashboardScreenDefinition;
  readonly t: Translate;
  readonly translate: Translate;
  readonly primitives: Primitives;
  readonly headerActions: ReturnType<typeof useRecordActions>;
  readonly setActionError: Dispatch<SetStateAction<ErrorNotice | null>>;
  readonly headerCompactContext: boolean;
  readonly usesPageHeaderSlot: boolean;
  readonly recordTitle: string | undefined;
  readonly scopeBadge: ReactNode;
  readonly picker: ReactNode;
  readonly rangeControl: ReactNode;
  readonly loadedAtMs: ReturnType<typeof useLoadedAt>["loadedAtMs"];
  readonly formatDateTime: ReturnType<typeof useDashboardFormats>["formatDateTime"];
};

export function recordTitleText(
  row: Readonly<Record<string, unknown>> | null,
  field: string | undefined,
) {
  if (row === null || field === undefined) return undefined;
  const value = row[field];
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value) === "" ? undefined : String(value);
}

export function buildScopeBadge(
  screen: DashboardScreenDefinition,
  translate: Translate,
): ReactNode {
  const scope = screen.scope;
  return scope !== undefined ? (
    <StatusBadge tone="accent" testId={`dashboard-${screen.id}-scope`}>
      {translate(scope.badge)}
    </StatusBadge>
  ) : null;
}

export function dashboardDescription(
  screen: DashboardScreenDefinition,
  translate: Translate,
): string | undefined {
  // A raw description is agent-facing prose; only an i18n key is user-facing copy.
  const translatedDescription =
    screen.description !== undefined ? translate(screen.description) : undefined;
  return translatedDescription !== screen.description ? translatedDescription : undefined;
}

export function renderRecordMissing(
  primitives: Primitives,
  t: Translate,
  screenId: string,
): ReactNode {
  const { Banner } = primitives;
  return (
    <Banner variant="info" testId={`dashboard-${screenId}-record-missing`}>
      {t("kumiko.dashboard.record.missing")}
    </Banner>
  );
}

export function renderHeaderActionsBar(model: DashboardHeaderModel): ReactNode {
  const { screen, headerActions, headerCompactContext, usesPageHeaderSlot, setActionError } = model;
  const { Button, Dialog, ActionOverflowMenu, Grid, PageHeader } = model.primitives;
  return headerActions !== undefined && headerActions.length > 0 ? (
    <Grid columns="auto" testId={`dashboard-${screen.id}-actions`}>
      <HeaderActionsBar
        actions={headerActions}
        Button={Button}
        Dialog={Dialog}
        ActionOverflowMenu={ActionOverflowMenu}
        onError={setActionError}
        collapseAfterPrimary={usesPageHeaderSlot}
        compact={headerCompactContext && usesPageHeaderSlot}
        PageHeader={PageHeader}
        overflowTestId={`dashboard-${screen.id}-actions-overflow`}
      />
    </Grid>
  ) : null;
}

export function renderPageHeaderSlot(
  model: DashboardHeaderModel,
  headerActionsBar: ReactNode,
  badgeInHeader: boolean,
): ReactNode {
  const { PageHeader } = model.primitives;
  const { recordTitle, scopeBadge, usesPageHeaderSlot } = model;
  const showPageHeader =
    usesPageHeaderSlot && (badgeInHeader || recordTitle !== undefined || headerActionsBar !== null);
  return (
    showPageHeader &&
    PageHeader !== undefined && (
      <PageHeader
        {...(recordTitle !== undefined && { title: recordTitle })}
        {...(badgeInHeader && { status: scopeBadge })}
        {...(headerActionsBar !== null && { actions: headerActionsBar })}
      />
    )
  );
}

export function renderTitleRow(
  model: DashboardHeaderModel,
  headerActionsBar: ReactNode,
  badgeInHeader: boolean,
): ReactNode {
  const { Heading } = model.primitives;
  const { screen, usesPageHeaderSlot, recordTitle, scopeBadge, picker, rangeControl } = model;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {!usesPageHeaderSlot && recordTitle !== undefined && (
          <Heading variant="page" testId={`dashboard-${screen.id}-record-title`}>
            {recordTitle}
          </Heading>
        )}
        {!badgeInHeader && scopeBadge}
        {picker}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!usesPageHeaderSlot && headerActionsBar}
        {screen.showUpdatedAt !== false && (
          <span
            data-testid={`dashboard-${screen.id}-updated-at`}
            className="text-xs tabular-nums text-muted-foreground"
          >
            {model.t("kumiko.dashboard.updated-at", {
              time: model.formatDateTime(model.loadedAtMs),
            })}
          </span>
        )}
        {rangeControl}
      </div>
    </div>
  );
}

export function renderActionErrorBanner(
  primitives: Primitives,
  actionError: ErrorNotice | null,
): ReactNode {
  const { Banner } = primitives;
  return (
    actionError !== null && (
      <Banner variant="error" testId="render-edit-action-error">
        {actionError.message}
        <ErrorReference requestId={actionError.requestId} />
      </Banner>
    )
  );
}

export function renderRecordError(
  model: DashboardHeaderModel,
  error: DispatcherError | null,
  recordRow: Readonly<Record<string, unknown>> | null,
  refetchRecord: () => Promise<void>,
): ReactNode {
  const { Button } = model.primitives;
  return (
    error !== null &&
    recordRow === null && (
      <div
        role="alert"
        data-testid={`dashboard-${model.screen.id}-record-error`}
        className="flex flex-col items-start gap-2 text-sm"
      >
        <span className="text-status-bad">{dispatcherErrorText(error, model.t)}</span>
        <Button variant="secondary" onClick={() => void refetchRecord()}>
          {model.t("kumiko.dashboard.panel.error.retry")}
        </Button>
      </div>
    )
  );
}

export function renderDescriptionAndNotice(
  model: DashboardHeaderModel,
  description: string | undefined,
): ReactNode {
  const { Text, Banner } = model.primitives;
  const { screen } = model;
  return (
    <>
      {description !== undefined && (
        <Text variant="muted" testId={`dashboard-${screen.id}-description`}>
          {description}
        </Text>
      )}
      {screen.scope?.notice !== undefined && (
        <Banner variant="info" testId={`dashboard-${screen.id}-scope-notice`}>
          {model.translate(screen.scope.notice)}
        </Banner>
      )}
    </>
  );
}
