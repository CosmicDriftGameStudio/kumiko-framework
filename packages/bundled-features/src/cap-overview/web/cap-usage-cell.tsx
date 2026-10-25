import type { ColumnRendererProps } from "@cosmicdrift/kumiko-renderer";
import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { ReactNode } from "react";
import type { CapUnit, CapUsage } from "../types.ts";
import { CapUsageBar } from "./cap-usage-bar.tsx";

const CAP_UNITS: readonly CapUnit[] = ["count", "mb", "tokens"];

function isCapUsage(value: unknown): value is CapUsage {
  if (!isPlainObject(value)) return false;
  const used = value["used"];
  const limit = value["limit"];
  return (
    (typeof used === "number" || used === null) &&
    (typeof limit === "number" || limit === null) &&
    typeof value["fraction"] === "number" &&
    (value["unit"] === undefined || isOneOf(CAP_UNITS, value["unit"]))
  );
}

export function CapUsageCell({ value }: ColumnRendererProps): ReactNode {
  if (!isCapUsage(value)) return null;
  return <CapUsageBar usage={value} />;
}
