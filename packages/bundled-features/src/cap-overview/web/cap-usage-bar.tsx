// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { CapUsage } from "../types";
import { computeTone } from "../usage-math";

export function CapUsageBar({
  usage,
  showLabel = true,
}: {
  readonly usage: CapUsage;
  // The cap-cards-panel StatCard already shows used/limit as its headline
  // value — the bar's own label would just repeat it there.
  readonly showLabel?: boolean;
}): ReactNode {
  const { Progress, Text, Banner } = usePrimitives();
  const t = useTranslation();

  if (usage.used === null) {
    return (
      <Text variant="small" testId="cap-usage-not-measured">
        {t("cap-overview.notMeasured")}
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {Progress ? (
        <Progress
          value={usage.fraction}
          tone={computeTone(usage.fraction)}
          testId="cap-usage-bar"
        />
      ) : (
        // Progress is typed optional only so partial CorePrimitives test
        // doubles keep compiling — production always registers it via
        // defaultPrimitives. If it's ever missing, say so instead of
        // silently dropping the bar (it's the requested content, not decoration).
        <Banner variant="error" testId="cap-usage-bar-missing-primitive">
          {t("cap-overview.errors.progressPrimitiveMissing")}
        </Banner>
      )}
      {showLabel && <Text variant="small">{`${usage.used} / ${usage.limit}`}</Text>}
    </div>
  );
}
