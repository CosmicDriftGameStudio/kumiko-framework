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
import { screenTitleKey } from "../layout/shell-breadcrumb.ts";
import { cn } from "../lib/cn.ts";
import { EmbeddedFormProvider } from "../primitives/index.tsx";
import { SectionCard } from "../widgets/section-card.tsx";
import { PanelError, WIDE_PANEL } from "./dashboard-shared.tsx";
import {
  NO_GATE_PAYLOAD,
  VisibilityQueryContext,
  visibilityGate,
} from "./dashboard-visibility.tsx";

// A raw description is agent-facing prose; only an i18n key is user-facing copy.
function embeddedDescription(raw: string | undefined, translate: Translate): string | undefined {
  if (raw === undefined) return undefined;
  const translated = translate(raw);
  return translated !== raw ? translated : undefined;
}

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
  const label = panel.label !== undefined ? translate(panel.label) : undefined;
  if (panel.chromeless !== true) {
    return (
      <div className={cn("min-w-0", WIDE_PANEL)} data-testid={`dashboard-panel-${panel.id}`}>
        {label !== undefined ? <SectionCard title={label}>{screenBody}</SectionCard> : screenBody}
      </div>
    );
  }
  // The tile owns the section head, so the embedded form drops its own title block.
  const titleKey = screenTitleKey(target.screenId);
  const translatedTitle = translate(titleKey);
  const title = label ?? (translatedTitle === titleKey ? target.screenId : translatedTitle);
  const description = embeddedDescription(target.description, translate);
  return (
    <div
      className={cn("min-w-0 border-t border-border pt-6 first:border-t-0 first:pt-0", WIDE_PANEL)}
      data-testid={`dashboard-panel-${panel.id}`}
    >
      <h3
        data-testid={`dashboard-panel-${panel.id}-title`}
        className="text-sm font-semibold text-foreground"
      >
        {title}
      </h3>
      {description !== undefined && (
        <p
          data-testid={`dashboard-panel-${panel.id}-description`}
          className="mt-1 text-sm text-muted-foreground"
        >
          {description}
        </p>
      )}
      <div className="mt-3">
        <EmbeddedFormProvider>
          <EmbeddedScreenProvider>{screenBody}</EmbeddedScreenProvider>
        </EmbeddedFormProvider>
      </div>
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
