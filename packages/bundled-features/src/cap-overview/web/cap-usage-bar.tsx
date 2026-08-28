// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { CapUsage } from "../types";

export function CapUsageBar({ usage }: { readonly usage: CapUsage }): ReactNode {
  const { Progress, Text, Banner } = usePrimitives();
  const t = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      {Progress ? (
        <Progress value={usage.fraction} testId="cap-usage-bar" />
      ) : (
        // Progress is typed optional only so partial CorePrimitives test
        // doubles keep compiling — production always registers it via
        // defaultPrimitives. If it's ever missing, say so instead of
        // silently dropping the bar (it's the requested content, not decoration).
        <Banner variant="error" testId="cap-usage-bar-missing-primitive">
          {t("cap-overview.errors.progressPrimitiveMissing")}
        </Banner>
      )}
      <Text variant="small">{`${usage.used} / ${usage.limit}`}</Text>
    </div>
  );
}
