import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useMemo } from "react";
import type { RenderEditAction } from "../components/render-edit.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import type { useProjectionDetailData } from "./use-projection-detail-data.ts";

const HEADER_CARD_DEFAULT_WIDTH = "4xl" as const;

type DetailLayoutInput = {
  readonly screen: ProjectionDetailScreenDefinition;
  readonly headerActions: readonly RenderEditAction[] | undefined;
  readonly hasTabs: boolean;
  readonly detailScreen: ReturnType<typeof useProjectionDetailData>["detailScreen"];
};

export function useProjectionDetailLayout(input: DetailLayoutInput) {
  const { screen, headerActions, hasTabs, detailScreen } = input;
  const hasHeader = screen.header !== undefined;
  const hasMetrics = screen.metrics !== undefined && screen.metrics.length > 0;
  // ?? [] rather than threading `headerActions !== undefined` through every
  // use below — an empty array is a safe no-op for .map/.length.
  const headerActionsList = headerActions ?? [];
  const hasHeaderActions = headerActionsList.length > 0;
  const hasHeaderCard = hasHeader || hasMetrics || hasHeaderActions;
  // A header card (metric band, status, actions) needs more room than the
  // 640px form column; screens with only a record title keep the narrow one.
  const widensScreenFormColumn =
    hasHeaderCard &&
    !hasTabs &&
    screenFillsHeight(screen) &&
    detailScreen.layout.width === undefined;
  const renderedDetailScreen = useMemo(
    () =>
      widensScreenFormColumn
        ? { ...detailScreen, layout: { ...detailScreen.layout, width: HEADER_CARD_DEFAULT_WIDTH } }
        : detailScreen,
    [detailScreen, widensScreenFormColumn],
  );
  return { hasMetrics, headerActionsList, hasHeaderActions, hasHeaderCard, renderedDetailScreen };
}
