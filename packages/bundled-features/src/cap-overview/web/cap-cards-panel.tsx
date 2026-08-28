// @runtime client
import type { ExtensionSectionProps } from "@cosmicdrift/kumiko-renderer";
import { usePrimitives, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { EmptyState, StatusBadge, type StatusTone } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { CapOverviewQueries } from "../constants";
import type { CapUsageTone, CapUsageWithMeta } from "../types";
import { CapUsageBar } from "./cap-usage-bar";

type CapsUsageResponse = { readonly rows: readonly CapUsageWithMeta[] };

// caps:usage's wire tone stays "default"/"warn"/"danger" (matches the
// server-side thresholds literally); mapped here to the renderer's actual
// StatusTone vocabulary instead of inventing new CSS ("danger" has no
// StatCard tone equivalent — "critical" is the closer semantic fit).
const TONE_TO_STATUS: Record<CapUsageTone, StatusTone> = {
  default: "muted",
  warn: "warn",
  danger: "critical",
};

export function CapCardsPanel({ filterParams }: ExtensionSectionProps): ReactNode {
  const t = useTranslation();
  const { Banner, Card } = usePrimitives();
  const tenantId =
    typeof filterParams?.["tenantId"] === "string" ? filterParams["tenantId"] : undefined;
  const query = useQuery<CapsUsageResponse | null>(CapOverviewQueries.capsUsage, {
    ...(tenantId !== undefined && { tenantId }),
  });

  if (query.error !== null) {
    return (
      <Banner variant="error" testId="cap-cards-panel-error">
        {query.error.message}
      </Banner>
    );
  }

  const rows = query.data?.rows ?? [];

  if (!query.loading && rows.length === 0) {
    return <EmptyState title={t("cap-overview.cards.empty")} testId="cap-cards-panel-empty" />;
  }

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-testid="cap-cards-panel"
    >
      {query.loading && rows.length === 0 && (
        <div className="text-sm text-muted-foreground">{t("cap-overview.cards.loading")}</div>
      )}
      {rows.map((cap) => {
        const statusTone = TONE_TO_STATUS[cap.tone];
        return (
          <Card key={cap.id} options={{ padded: false }} className="p-4" testId="cap-card">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">{t(cap.label)}</span>
              <StatusBadge tone={statusTone}>{`${cap.percent}%`}</StatusBadge>
            </div>
            <div className="mt-3">
              <CapUsageBar usage={cap} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
