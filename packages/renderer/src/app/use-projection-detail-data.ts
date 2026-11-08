import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const live = screen.live === true;
  const detailQuery = useQuery<Readonly<Record<string, unknown>>>(
    screen.query,
    effectiveEntityId !== undefined ? { [idParam]: effectiveEntityId } : {},
    { live },
  );
  const record = detailQuery.data;
  // A section hidden by `visibleWhen` drops out of the tab strip and the body alike; until the
  // record is loaded nothing is evaluated (the loading banner shows instead).
  const visibleSections = useMemo(
    () =>
      screen.layout.sections.filter(
        (section) =>
          section.visibleWhen === undefined ||
          (record !== null && evalFieldCondition(section.visibleWhen, { ...record })),
      ),
    [screen.layout.sections, record],
  );
  // Adjacent sections sharing one `id` form a single tab (several blocks under one tab label).
  const activeSections = useMemo(() => {
    // skip: only tabs mode with a registered Tabs primitive has an active section
    if (!isTabsMode || Tabs === undefined) return [];
    const tabParam = nav.searchParams["tab"];
    const activeId =
      visibleSections.find((section) => section.id === tabParam)?.id ??
      initialTabId(screen.initialTab, record, visibleSections) ??
      visibleSections[0]?.id;
    return visibleSections.filter((section) => section.id === activeId);
  }, [isTabsMode, Tabs, visibleSections, nav.searchParams, screen.initialTab, record]);
  const activeSection = activeSections[0];
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
    if (activeSections.length > 0 && screen.layout.narrowTabs === false) {
      // Below `sm` there is no tab strip: every visible section renders, the ones of the
      // other tabs only on the phone. A `hideOnNarrow` section of another tab has no place at
      // all (hideOnNarrow would win over showOnNarrowOnly and show it on desktop).
      const sections = visibleSections.flatMap((section) => {
        if (activeSections.includes(section)) return [section];
        if ("hideOnNarrow" in section && section.hideOnNarrow === true) return [];
        return [{ ...section, showOnNarrowOnly: true as const }];
      });
      return synthesizeProjectionDetailScreen({
        ...screen,
        layout: { ...screen.layout, sections },
      });
    }
    const source =
      activeSections.length > 0
        ? { ...screen, layout: { ...screen.layout, sections: activeSections } }
        : screen;
    return synthesizeProjectionDetailScreen(source);
  }, [screen, activeSections, visibleSections]);

  // A writeForm section's handler creates a new record (see EditWriteFormSection's
  // doc) — both the outer record (header/metrics/other sections) and a sibling
  // relatedList section's own independently-fetched rows must reflect it. A
  // query refetch alone only refreshes `record` below; bumping this as
  // <RenderEdit>'s refreshToken makes RelatedListSection's own useQuery
  // re-run too (it has no `live` subscription of its own). Refetch instead of
  // remount (a `key`) so unsaved input in the other writeForm sections and
  // the related lists' local state survive.
  const [reloadNonce, setReloadNonce] = useState(0);
  // Live mode: every refetched record bumps the nonce below, a write included.
  const reloadDetail = useCallback(async () => {
    await refetchAfterWrite(detailQuery.refetch);
    if (!live) setReloadNonce((n) => n + 1);
  }, [detailQuery.refetch, live]);
  // A live refetch only reaches the record; the related lists hold their own rows.
  const liveRecord = live ? (detailQuery.data ?? undefined) : undefined;
  const shownLiveRecord = useRef(liveRecord);
  useEffect(() => {
    const previous = shownLiveRecord.current;
    // skip: the shown record is unchanged, the related lists need no reload.
    if (previous === liveRecord) return;
    shownLiveRecord.current = liveRecord;
    if (previous !== undefined) setReloadNonce((n) => n + 1);
  }, [liveRecord]);
  return {
    activeSection,
    activeSections,
    visibleSections,
    hasTabs,
    entity,
    detailScreen,
    detailQuery,
    reloadNonce,
    reloadDetail,
  };
}

function initialTabId(
  rules: ProjectionDetailScreenDefinition["initialTab"],
  record: Readonly<Record<string, unknown>> | null,
  visibleSections: ProjectionDetailScreenDefinition["layout"]["sections"],
): string | undefined {
  if (rules === undefined || record === null) return undefined;
  return rules.find(
    (rule) =>
      evalFieldCondition(rule.when, { ...record }) &&
      visibleSections.some((section) => section.id === rule.tab),
  )?.tab;
}
