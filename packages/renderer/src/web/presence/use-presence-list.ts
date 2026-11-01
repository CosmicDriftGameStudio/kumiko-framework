import {
  PRESENCE_CHANGED_EVENT,
  PRESENCE_LIST_MAX_IDS,
  PRESENCE_LIST_REFETCH_INTERVAL_MS,
  PRESENCE_QUERIES,
  type PresenceEntry,
  type PresenceListResult,
} from "@cosmicdrift/kumiko-types/presence-types";
import { useEffect, useState } from "react";
import { useQuery } from "../../hooks/use-query.ts";
import { useLiveEvents } from "../../sse/live-events.tsx";
import { isPermanentPresenceFailure, isPresenceSignalFor } from "./presence-signal.ts";

export type UsePresenceListOptions = {
  readonly entity: string;
  readonly ids: readonly string[];
  readonly enabled?: boolean;
};

export type UsePresenceListResult = {
  readonly byId: Readonly<Record<string, readonly PresenceEntry[]>>;
};

const NO_ENTRIES: UsePresenceListResult["byId"] = {};

/** Who else is on each of the given rows, for badges in a list. Polls every 25 s and refetches on
 *  the live signal of that entity; goes quiet after a permanent failure such as an unmounted feature. */
export function usePresenceList({
  entity,
  ids,
  enabled = true,
}: UsePresenceListOptions): UsePresenceListResult {
  const subscribe = useLiveEvents();
  const [gaveUpOn, setGaveUpOn] = useState<string | null>(null);
  const gaveUp = gaveUpOn === entity;
  const active = enabled && !gaveUp;
  const pageIds = ids.slice(0, PRESENCE_LIST_MAX_IDS);
  const query = useQuery<PresenceListResult>(
    PRESENCE_QUERIES.list,
    { entity, ids: pageIds },
    {
      enabled: active && pageIds.length > 0,
      ...(active && { refetchIntervalMs: PRESENCE_LIST_REFETCH_INTERVAL_MS }),
    },
  );
  const { refetch, error } = query;

  useEffect(() => {
    if (error !== null && isPermanentPresenceFailure(error)) setGaveUpOn(entity);
  }, [error, entity]);

  useEffect(() => {
    // skip: nothing to listen for while the list is off or has given up
    if (!active) return;
    return subscribe(PRESENCE_CHANGED_EVENT, (event) => {
      if (isPresenceSignalFor(event.data, entity)) void refetch();
    });
  }, [subscribe, active, entity, refetch]);

  return { byId: gaveUp ? NO_ENTRIES : (query.data?.byId ?? NO_ENTRIES) };
}
