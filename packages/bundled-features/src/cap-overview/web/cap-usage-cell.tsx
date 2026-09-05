// @runtime client
import type { ColumnRendererProps } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import type { CapUsage } from "../types";
import { CapUsageBar } from "./cap-usage-bar";

function isCapUsage(value: unknown): value is CapUsage {
  if (typeof value !== "object" || value === null) return false;
  const used = (value as { used?: unknown }).used;
  const limit = (value as { limit?: unknown }).limit;
  return (
    (typeof used === "number" || used === null) &&
    (typeof limit === "number" || limit === null) &&
    typeof (value as { fraction?: unknown }).fraction === "number"
  );
}

export function CapUsageCell({ value }: ColumnRendererProps): ReactNode {
  if (!isCapUsage(value)) return null;
  return <CapUsageBar usage={value} />;
}
