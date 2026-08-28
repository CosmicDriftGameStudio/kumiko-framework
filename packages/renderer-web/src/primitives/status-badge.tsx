import type { StatusBadgeProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { StatusBadge } from "../widgets/status-badge";

export function DefaultStatusBadge({ value, tone, testId }: StatusBadgeProps): ReactNode {
  return (
    <StatusBadge tone={tone ?? "muted"} testId={testId}>
      {value}
    </StatusBadge>
  );
}
