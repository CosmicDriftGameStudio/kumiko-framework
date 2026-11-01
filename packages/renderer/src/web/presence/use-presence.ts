import {
  PRESENCE_CHANGED_EVENT,
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_WRITES,
  type PresenceActivity,
  type PresenceEntry,
  type PresenceHeartbeatResult,
} from "@cosmicdrift/kumiko-types/presence-types";
import { useEffect, useRef, useState } from "react";
import { useDispatcher } from "../../context/dispatcher-context.tsx";
import { useLiveEvents } from "../../sse/live-events.tsx";
import { isPermanentPresenceFailure, isPresenceSignalFor } from "./presence-signal.ts";

export type UsePresenceOptions = {
  readonly entity: string;
  readonly id: string;
  readonly activity: PresenceActivity;
  /** Which part of the record the user is on, e.g. `field:title`. */
  readonly focus?: string;
  readonly enabled?: boolean;
};

export type UsePresenceResult = { readonly others: readonly PresenceEntry[] };

const NO_ENTRIES: readonly PresenceEntry[] = [];

function stateKey(activity: PresenceActivity, focus: string | undefined): string {
  return `${activity}|${focus ?? ""}`;
}

/** Announces the user on one record: a heartbeat right away and every 15 s, a leave when the
 *  record closes. Returns the other people on it. Silent when the presence feature is not
 *  mounted or the record is off limits: no error, no retries. */
export function usePresence({
  entity,
  id,
  activity,
  focus,
  enabled = true,
}: UsePresenceOptions): UsePresenceResult {
  const dispatcher = useDispatcher();
  const subscribe = useLiveEvents();
  const [others, setOthers] = useState<readonly PresenceEntry[]>(NO_ENTRIES);
  const latest = useRef({ activity, focus });
  latest.current = { activity, focus };
  const lastSentKey = useRef("");
  const beat = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setOthers(NO_ENTRIES);
    // skip: presence is switched off for this record
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = (): void => {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      setOthers(NO_ENTRIES);
    };
    const send = async (): Promise<void> => {
      // skip: the record closed or presence gave up after a permanent failure
      if (stopped) return;
      const current = latest.current;
      lastSentKey.current = stateKey(current.activity, current.focus);
      const result = await dispatcher.write<PresenceHeartbeatResult>(PRESENCE_WRITES.heartbeat, {
        entity,
        id,
        activity: current.activity,
        ...(current.focus !== undefined && { focus: current.focus }),
      });
      // skip: the answer belongs to a record that is no longer open
      if (stopped) return;
      if (result.isSuccess) setOthers(result.data.others);
      else if (isPermanentPresenceFailure(result.error)) stop();
    };
    beat.current = send;

    void send();
    timer = setInterval(() => void send(), PRESENCE_HEARTBEAT_INTERVAL_MS);
    const unsubscribe = subscribe(PRESENCE_CHANGED_EVENT, (event) => {
      if (isPresenceSignalFor(event.data, entity, id)) void send();
    });

    return () => {
      const wasStopped = stopped;
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      unsubscribe();
      beat.current = async () => {};
      if (!wasStopped) void dispatcher.write(PRESENCE_WRITES.leave, { entity, id });
    };
  }, [dispatcher, subscribe, entity, id, enabled]);

  useEffect(() => {
    if (stateKey(activity, focus) !== lastSentKey.current) void beat.current();
  }, [activity, focus]);

  return { others };
}
