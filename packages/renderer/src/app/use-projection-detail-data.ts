import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { rendererWarn } from "../dev-console.ts";
import { useQuery } from "../hooks/use-query.ts";
import type { usePrimitives } from "../primitives.tsx";
import type { NavApi } from "./nav.tsx";
import {
  synthesizeProjectionDetailEntity,
  synthesizeProjectionDetailScreen,
} from "./projection-detail-shim.ts";
import { refetchAfterWrite } from "./row-actions.ts";

type DetailDataInput = {
  readonly screen: ProjectionDetailScreenDefinition;
  readonly Tabs: ReturnType<typeof usePrimitives>["Tabs"];
  readonly nav: NavApi;
  readonly effectiveEntityId: string | undefined;
};

export function useProjectionDetailData(input: DetailDataInput) {
  const { screen, Tabs, nav, effectiveEntityId } = input;
  const idParam = screen.idParam ?? "id";
  const isTabsMode = screen.layout.mode === "tabs";
  const activeSection = useMemo(() => {
    // skip: only tabs mode with a registered Tabs primitive has an active section
    if (!isTabsMode || Tabs === undefined) return undefined;
    const tabParam = nav.searchParams["tab"];
    return (
      screen.layout.sections.find((section) => section.id === tabParam) ?? screen.layout.sections[0]
    );
  }, [isTabsMode, Tabs, screen.layout.sections, nav.searchParams]);
  const hasTabs = isTabsMode && Tabs !== undefined && activeSection !== undefined;
  // Tabs is an optional Core-Primitive: without it the screen falls back to
  // the stacked all-sections layout instead of silently truncating to section 1.
  useEffect(() => {
    if (isTabsMode && Tabs === undefined) {
      rendererWarn(
        `[kumiko] screen "${screen.id}" uses layout.mode: "tabs", but no <Tabs> primitive is registered — the tab strip will not render. createKumikoApp() from kumiko-renderer-web wires it automatically.`,
      );
    }
  }, [isTabsMode, Tabs, screen.id]);
  const entity = useMemo(() => synthesizeProjectionDetailEntity(screen.layout), [screen.layout]);
  const detailScreen = useMemo(() => {
    const source =
      activeSection !== undefined
        ? { ...screen, layout: { ...screen.layout, sections: [activeSection] } }
        : screen;
    return synthesizeProjectionDetailScreen(source);
  }, [screen, activeSection]);
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(
    screen.query,
    effectiveEntityId !== undefined ? { [idParam]: effectiveEntityId } : {},
  );

  // A writeForm section's handler creates a new record (see EditWriteFormSection's
  // doc) — both the outer record (header/metrics/other sections) and a sibling
  // relatedList section's own independently-fetched rows must reflect it. A
  // query refetch alone only refreshes `record` below; bumping this as
  // <RenderEdit>'s refreshToken makes RelatedListSection's own useQuery
  // re-run too (it has no `live` subscription of its own). Refetch instead of
  // remount (a `key`) so unsaved input in the other writeForm sections and
  // the related lists' local state survive.
  const [reloadNonce, setReloadNonce] = useState(0);
  const reloadDetail = useCallback(async () => {
    await refetchAfterWrite(detailQuery.refetch);
    setReloadNonce((n) => n + 1);
  }, [detailQuery.refetch]);
  return { activeSection, hasTabs, entity, detailScreen, detailQuery, reloadNonce, reloadDetail };
}
