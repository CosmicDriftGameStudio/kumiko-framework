import type { ExtensionSectionProps } from "@cosmicdrift/kumiko-renderer";
import {
  useLocale,
  useNav,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { EMPTY_VALUE_PLACEHOLDER, type Translate } from "@cosmicdrift/kumiko-renderer/headless";
import {
  EmptyState,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "@cosmicdrift/kumiko-renderer/web";
import { Database, FileText, Gauge, Hash, Mail, Users } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { CapIconKey, CapUnit, CapUsageTone, CapUsageWithMeta } from "../types.ts";
import { formatCapAmount, formatCapUsedOfLimit } from "./cap-amount-format.ts";
import { CapUsageBar } from "./cap-usage-bar.tsx";
import { CapOverviewQueries, MY_CAPS_SCREEN_ID } from "./constants.ts";
import { isCapNotIncluded } from "./usage-math.ts";

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

// Boundary check: only an array of strings restricts; anything else means no restriction.
function readCapKeys(value: unknown): ReadonlySet<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  return new Set(value.filter((entry): entry is string => typeof entry === "string"));
}

function ViewAllLink(): ReactNode {
  const t = useTranslation();
  const { Link } = usePrimitives();
  const nav = useNav();
  const target = { screenId: MY_CAPS_SCREEN_ID };
  return (
    <Link
      href={nav.hrefFor(target)}
      onPress={() => nav.navigate(target)}
      testId="cap-cards-view-all"
    >
      {t("cap-overview.cards.viewAll")}
    </Link>
  );
}

function CapUsageSummaryRow({ cap }: { readonly cap: CapUsageWithMeta }): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const remainingText =
    isMeasured(cap) && cap.limit !== null && cap.limit > 0
      ? remainingLabel(t, Math.max(cap.limit - cap.used, 0), cap.unit, locale)
      : undefined;
  if (cap.percent === null && remainingText === undefined) return null;
  return (
    <div className="flex items-center gap-2">
      {cap.percent !== null && (
        <StatusBadge tone={TONE_TO_STATUS[cap.tone]}>{`${cap.percent}%`}</StatusBadge>
      )}
      {remainingText !== undefined && (
        <span className="text-sm text-muted-foreground" data-testid="cap-card-remaining">
          {remainingText}
        </span>
      )}
    </div>
  );
}

function remainingLabel(
  t: Translate,
  rest: number,
  unit: CapUnit | undefined,
  locale: string,
): string {
  return rest > 0
    ? t("cap-overview.cards.remaining", { amount: formatCapAmount(rest, unit, locale) })
    : t("cap-overview.cards.noneLeft");
}

function CapUsageStat({
  cap,
  footer,
}: {
  readonly cap: CapUsageWithMeta;
  readonly footer?: ReactNode;
}): ReactNode {
  const t = useTranslation();
  const locale = useLocale().locale();
  const Icon = cap.icon !== undefined ? CAP_ICONS[cap.icon] : undefined;
  // An unlimited, measured cap has neither a badge nor a bar; StatCard still
  // wraps any defined child in a spacing div, so pass undefined then.
  const notIncluded = isCapNotIncluded(cap.limit);
  const body =
    !notIncluded && (!isMeasured(cap) || cap.limit !== null) ? (
      <div className="flex flex-col gap-2">
        <CapUsageSummaryRow cap={cap} />
        <CapUsageBar usage={cap} showLabel={false} />
        {footer}
      </div>
    ) : (
      footer
    );
  return (
    <StatCard
      icon={Icon !== undefined ? <Icon className="size-4" /> : undefined}
      label={t(cap.label)}
      value={
        notIncluded
          ? t("cap-overview.notIncluded")
          : !isMeasured(cap)
            ? EMPTY_VALUE_PLACEHOLDER
            : cap.limit === null
              ? formatCapAmount(cap.used, cap.unit, locale)
              : formatCapUsedOfLimit(cap.used, cap.limit, cap.unit, locale)
      }
      {...(cap.accentColor !== undefined && { accentColor: cap.accentColor })}
      testId="cap-card"
    >
      {body}
    </StatCard>
  );
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

  const capKeys = readCapKeys(filterParams?.["capKeys"]);
  const allRows = query.data?.rows ?? [];
  const rows = capKeys === undefined ? allRows : allRows.filter((row) => capKeys.has(row.id));

  if (!query.loading && rows.length === 0) {
    return <EmptyState title={t("cap-overview.cards.empty")} testId="cap-cards-panel-empty" />;
  }

  // A single limited card carries the link itself; several share one under the grid.
  const linkInCard = capKeys !== undefined && rows.length === 1;
  return (
    <div className="flex flex-col gap-2">
      <div
        // Arbitrary bracket values (grid-cols-[repeat(...)]) never compiled:
        // styles.css's Tailwind v4 @source scan only covers renderer/web/src,
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
        {rows.map((cap) => (
          <CapUsageStat key={cap.id} cap={cap} footer={linkInCard ? <ViewAllLink /> : undefined} />
        ))}
      </div>
      {capKeys !== undefined && !linkInCard && <ViewAllLink />}
    </div>
  );
}
