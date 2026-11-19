import { useLocale, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { CapUsage } from "../types.ts";
import { formatCapAmount, formatCapUsedOfLimit } from "./cap-amount-format.ts";
import { computeTone, isCapNotIncluded, isCapUsedWithoutAllowance } from "./usage-math.ts";

export function CapUsageBar({
  usage,
  showLabel = true,
}: {
  readonly usage: CapUsage;
  // The cap-cards-panel StatCard already shows used/limit as its headline
  // value — the bar's own label would just repeat it there.
  readonly showLabel?: boolean;
}): ReactNode {
  const { Progress, Text } = usePrimitives();
  const t = useTranslation();
  const locale = useLocale().locale();

  if (isCapNotIncluded(usage.limit)) {
    if (isCapUsedWithoutAllowance(usage.limit, usage.used)) {
      return (
        <Text variant="small" testId="cap-usage-not-included-used">
          {t("cap-overview.notIncludedButUsed", {
            used: formatCapAmount(usage.used ?? 0, usage.unit, locale),
          })}
        </Text>
      );
    }
    return (
      <Text variant="small" testId="cap-usage-not-included">
        {t("cap-overview.notIncluded")}
      </Text>
    );
  }

  if (usage.used === null) {
    return (
      <Text variant="small" testId="cap-usage-not-measured">
        {t("cap-overview.notMeasured")}
      </Text>
    );
  }

  if (usage.limit === null) {
    // A progress bar with no denominator says nothing — show the raw count instead.
    return showLabel ? (
      <Text variant="small" testId="cap-usage-unlimited">
        {t("cap-overview.unlimited", { used: formatCapAmount(usage.used, usage.unit, locale) })}
      </Text>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-1">
      <Progress value={usage.fraction} tone={computeTone(usage.fraction)} testId="cap-usage-bar" />
      {showLabel && (
        <Text variant="small">
          {formatCapUsedOfLimit(usage.used, usage.limit, usage.unit, locale)}
        </Text>
      )}
    </div>
  );
}
