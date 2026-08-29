import type { MetricProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { MiniStat } from "../widgets/stat";

export function DefaultMetric({ label, value, testId }: MetricProps): ReactNode {
  return (
    <MiniStat
      label={label}
      value={value}
      testId={testId}
      {...(testId !== undefined && {
        labelTestId: `${testId}-label`,
        valueTestId: `${testId}-value`,
      })}
    />
  );
}
