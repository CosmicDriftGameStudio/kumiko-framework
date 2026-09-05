// @runtime client
import type { ExtensionSectionProps } from "@cosmicdrift/kumiko-renderer";
import { usePrimitives, useQuery, useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  EmptyState,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "@cosmicdrift/kumiko-renderer-web";
import { Database, FileText, Gauge, Hash, Mail, Users } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { CapOverviewQueries } from "../constants";
import type { CapIconKey, CapUsageTone, CapUsageWithMeta } from "../types";
import { CapUsageBar } from "./cap-usage-bar";

type CapsUsageResponse = { readonly rows: readonly CapUsageWithMeta[] };

// caps:usage's wire tone stays "default"/"warn"/"danger" (matches the
// server-side thresholds literally); mapped here to the renderer's actual
// StatusTone vocabulary instead of inventing new CSS ("danger" has no
// StatusBadge tone equivalent — "critical" is the closer semantic fit).
const TONE_TO_STATUS: Record<CapUsageTone, StatusTone> = {
  default: "muted",
  warn: "warn",
  danger: "critical",
};

// Matches CapIconKey (types.ts) 1:1 — extend both together.
const CAP_ICONS: Record<CapIconKey, ComponentType<{ className?: string }>> = {
  file: FileText,
  hash: Hash,
  database: Database,
  users: Users,
  mail: Mail,
  gauge: Gauge,
};

// Narrows `used` only — `percent` can independently be null for an
// unlimited cap (limit: null) even though used is measured.
function isMeasured(cap: CapUsageWithMeta): cap is CapUsageWithMeta & { used: number } {
  return cap.used !== null;
}

export function CapCardsPanel({ filterParams }: ExtensionSectionProps): ReactNode {
  const t = useTranslation();
  const { Banner } = usePrimitives();
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
      // Arbitrary bracket values (grid-cols-[repeat(...)]) never compiled:
      // styles.css's Tailwind v4 @source scan only covers renderer-web/src,
      // renderer/src and samples/**/src (see its comment) — bundled-features
      // isn't scanned, so a class unique to this file has no generated rule
      // and silently no-ops (the grid fell back to one implicit column,
      // stacking every card full-width). Reusing the exact classes
      // dashboard-body.tsx's own panel grid already uses guarantees the
      // rule exists, since that file IS in the scanned surface.
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="cap-cards-panel"
    >
      {query.loading && rows.length === 0 && (
        <div className="text-sm text-muted-foreground">{t("cap-overview.cards.loading")}</div>
      )}
      {rows.map((cap) => {
        const Icon = cap.icon !== undefined ? CAP_ICONS[cap.icon] : undefined;
        return (
          <StatCard
            key={cap.id}
            icon={Icon !== undefined ? <Icon className="size-4" /> : undefined}
            label={t(cap.label)}
            value={
              !isMeasured(cap)
                ? "—"
                : cap.limit === null
                  ? String(cap.used)
                  : `${cap.used} / ${cap.limit}`
            }
            {...(cap.accentColor !== undefined && { accentColor: cap.accentColor })}
            testId="cap-card"
          >
            <div className="flex flex-col gap-2">
              {cap.percent !== null && (
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge tone={TONE_TO_STATUS[cap.tone]}>{`${cap.percent}%`}</StatusBadge>
                </div>
              )}
              <CapUsageBar usage={cap} showLabel={false} />
            </div>
          </StatCard>
        );
      })}
    </div>
  );
}
