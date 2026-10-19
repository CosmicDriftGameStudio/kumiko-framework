import type { ReactNode } from "react";
import type { StatusBadgeProps } from "../../index.ts";
import { StatusBadge } from "../widgets/status-badge.tsx";

export function DefaultStatusBadge({ value, tone, testId }: StatusBadgeProps): ReactNode {
  return (
    <StatusBadge tone={tone ?? "muted"} testId={testId}>
      {value}
    </StatusBadge>
  );
}
