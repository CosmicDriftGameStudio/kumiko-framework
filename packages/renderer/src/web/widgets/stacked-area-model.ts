import type { StackedAreaGeometry } from "./stacked-area-geometry.ts";
import type { ResolvedStackedAreaProps } from "./stacked-area-props.ts";
import type { useStackedAreaTooltip } from "./use-stacked-area-tooltip.ts";
import type { useStackedAreaWindow } from "./use-stacked-area-window.ts";

export type StackedAreaModel = {
  readonly props: ResolvedStackedAreaProps;
  readonly clipId: string;
  readonly win: ReturnType<typeof useStackedAreaWindow>;
  readonly tooltip: ReturnType<typeof useStackedAreaTooltip>;
  readonly geometry: StackedAreaGeometry;
};
