// @runtime client
import type { ColumnRendererProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { CapUsage } from "../types";
import { CapUsageBar } from "./cap-usage-bar";

function isCapUsage(value: unknown): value is CapUsage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { used?: unknown }).used === "number" &&
    typeof (value as { limit?: unknown }).limit === "number" &&
    typeof (value as { fraction?: unknown }).fraction === "number"
  );
}

export function CapUsageCell({ value }: ColumnRendererProps): ReactNode {
  if (!isCapUsage(value)) return null;
  return <CapUsageBar usage={value} />;
}
