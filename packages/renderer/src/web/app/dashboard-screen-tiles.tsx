import type { DashboardScreenPanel } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useContext } from "react";
import type { Translate } from "../../headless/index.ts";
import {
  EmbeddedScreenProvider,
  type EmbeddedScreenTarget,
  evalVisibleWhen,
  KumikoScreen,
  useEmbeddedScreen,
} from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { EmbeddedFormProvider } from "../primitives/index.tsx";
import { SectionCard } from "../widgets/section-card.tsx";
import { PanelError, WIDE_PANEL } from "./dashboard-shared.tsx";
import {
  NO_GATE_PAYLOAD,
  VisibilityQueryContext,
  visibilityGate,
} from "./dashboard-visibility.tsx";

function EmbeddedScreenPanelTile({
  recordId,
  panel,
  target,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly target: EmbeddedScreenTarget;
  readonly recordId: string | undefined;
  readonly translate: Translate;
}): ReactNode {
  // Only a record screen takes the dashboard's bound record; other screens have no id to read.
  const entityId = target.screenType === "projectionDetail" ? recordId : undefined;
  const screenBody = (
    <KumikoScreen
      schema={target.schema}
      qn={target.qn}
      translate={translate}
      {...(entityId !== undefined && { entityId })}
    />
  );
  const embedded =
    panel.chromeless === true ? (
      <EmbeddedFormProvider>
        <EmbeddedScreenProvider>{screenBody}</EmbeddedScreenProvider>
      </EmbeddedFormProvider>
    ) : (
      screenBody
    );
  return (
    <div className={cn("min-w-0", WIDE_PANEL)} data-testid={`dashboard-panel-${panel.id}`}>
      {panel.label !== undefined && panel.chromeless !== true ? (
        <SectionCard title={translate(panel.label)}>{embedded}</SectionCard>
      ) : (
        <>
          {panel.label !== undefined && (
            <h3 className="mb-3 text-sm font-semibold text-foreground">{translate(panel.label)}</h3>
          )}
          {embedded}
        </>
      )}
    </div>
  );
}

// Own component so the target lookup (a hook) only runs for panels that actually fall back.
function FallbackScreenPanelTile({
  panel,
  fallback,
  featureName,
  recordId,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly fallback: string;
  readonly featureName: string;
  readonly recordId: string | undefined;
  readonly translate: Translate;
}): ReactNode {
  const target = useEmbeddedScreen(featureName, fallback);
  if (target === undefined) return null;
  return (
    <EmbeddedScreenPanelTile
      panel={panel}
      target={target}
      recordId={recordId}
      translate={translate}
    />
  );
}

export function ScreenPanelTile({
  panel,
  featureName,
  recordId,
  translate,
}: {
  readonly panel: DashboardScreenPanel;
  readonly featureName: string;
  readonly recordId: string | undefined;
  readonly translate: Translate;
}): ReactNode {
  const visibleWhen = panel.visibleWhen;
  const visibility = useContext(VisibilityQueryContext).get(
    visibleWhen !== undefined ? visibilityGate(visibleWhen.query, NO_GATE_PAYLOAD).key : "",
  );
  const target = useEmbeddedScreen(featureName, panel.screen);
  const verdict = visibleWhen === undefined ? "visible" : evalVisibleWhen(visibleWhen, visibility);
  // Nothing while the gate loads: a fallback that flashes before the real panel flickers.
  if (verdict === "loading") return null;
  if (verdict !== "visible" && panel.fallback !== undefined) {
    return (
      <FallbackScreenPanelTile
        panel={panel}
        fallback={panel.fallback}
        featureName={featureName}
        recordId={recordId}
        translate={translate}
      />
    );
  }
  if (target === undefined) return null;
  // A failed gate query must not silently drop the panel: on the
  // account-security page that would hide every MFA enable/disable path.
  if (verdict === "error" && visibility?.error) {
    return (
      <div className={cn("min-w-0", WIDE_PANEL)} data-testid={`dashboard-panel-${panel.id}`}>
        <PanelError
          label={panel.label !== undefined ? translate(panel.label) : panel.id}
          error={visibility.error}
          onRetry={() => void visibility.refetch()}
        />
      </div>
    );
  }
  if (verdict !== "visible") return null;
  return (
    <EmbeddedScreenPanelTile
      panel={panel}
      target={target}
      recordId={recordId}
      translate={translate}
    />
  );
}
