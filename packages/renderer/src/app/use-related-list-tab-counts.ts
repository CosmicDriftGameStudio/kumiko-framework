import type { EditSectionSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { useEffect, useMemo, useState } from "react";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { liveEntitiesForQuery, subscribeToEntities } from "../hooks/live-query-entities.ts";
import { createLiveRefetchScheduler } from "../hooks/live-refetch-scheduler.ts";
import { buildRelatedListParentPayload } from "../hooks/related-list-parent-payload.ts";
import { useLiveEvents } from "../sse/live-events.tsx";
import { useAppFeatures } from "./app-features-context.tsx";

type CountRequest = {
  readonly sectionId: string;
  readonly query: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

// Tab badges come from each section's own query (`limit: 1, totalCount: true` → `total`), so
// they match the tab's rows and refresh on the same live events.
export function useRelatedListTabCounts(args: {
  readonly sections: readonly EditSectionSpec[];
  readonly parentId: string | undefined;
}): Readonly<Record<string, number>> {
  const { sections, parentId } = args;
  const dispatcher = useOptionalDispatcher();
  const features = useAppFeatures();
  const subscribeLive = useLiveEvents();
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});

  const requests = useMemo((): readonly CountRequest[] => {
    if (parentId === undefined) return [];
    const out: CountRequest[] = [];
    for (const section of sections) {
      if (section.kind !== "relatedList" || section.count !== true || section.id === undefined) {
        continue;
      }
      out.push({
        sectionId: section.id,
        query: section.query,
        payload: {
          ...buildRelatedListParentPayload(section, parentId),
          limit: 1,
          totalCount: true,
        },
      });
    }
    return out;
  }, [sections, parentId]);

  useEffect(() => {
    // skip: nothing to count, or no dispatcher mounted
    if (requests.length === 0 || dispatcher === undefined) return;
    const ctrl = new AbortController();
    const load = async (): Promise<void> => {
      const results = await Promise.all(
        requests.map((request) =>
          dispatcher.query<{ readonly total?: number }>(request.query, request.payload, {
            signal: ctrl.signal,
          }),
        ),
      );
      // skip: unmounted or superseded while the queries were in flight
      if (ctrl.signal.aborted) return;
      const next: Record<string, number> = {};
      results.forEach((result, index) => {
        const total = result.isSuccess ? result.data?.total : undefined;
        const request = requests[index];
        if (request !== undefined && typeof total === "number") next[request.sectionId] = total;
      });
      setCounts(next);
    };
    void load();
    const scheduler = createLiveRefetchScheduler(load);
    const entities = [...new Set(requests.flatMap((r) => liveEntitiesForQuery(r.query, features)))];
    const unsubscribe = subscribeToEntities(subscribeLive, entities, scheduler.trigger);
    return () => {
      ctrl.abort();
      unsubscribe();
      scheduler.dispose();
    };
  }, [requests, dispatcher, features, subscribeLive]);

  return counts;
}
