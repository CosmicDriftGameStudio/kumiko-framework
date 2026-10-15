// @runtime client

import type { ColumnRendererProps } from "@cosmicdrift/kumiko-renderer";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { ReactNode } from "react";
import type { CapUsage } from "../types.js";
import { CapUsageBar } from "./cap-usage-bar.js";

function isCapUsage(value: unknown): value is CapUsage {
  if (!isPlainObject(value)) return false;
  const used = value["used"];
  const limit = value["limit"];
  return (
    (typeof used === "number" || used === null) &&
    (typeof limit === "number" || limit === null) &&
    typeof value["fraction"] === "number"
  );
}

export function CapUsageCell({ value }: ColumnRendererProps): ReactNode {
  if (!isCapUsage(value)) return null;
  return <CapUsageBar usage={value} />;
}
