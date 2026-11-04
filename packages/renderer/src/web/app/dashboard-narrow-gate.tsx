import type { ReactNode } from "react";
import { useIsBelowSmViewport } from "../primitives/use-narrow-viewport.ts";

/** Leaves its panel unmounted below `sm`, so a hidden panel runs no query. */
export function HiddenOnNarrow({
  hide,
  children,
}: {
  readonly hide: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const belowSm = useIsBelowSmViewport();
  return hide && belowSm ? null : children;
}
