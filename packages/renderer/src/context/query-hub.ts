import type { Dispatcher, DispatcherError, QueryResult } from "../headless/index.ts";
import { isRecord } from "../headless/is-record.ts";
import { subscribeToEntities } from "../hooks/live-query-entities.ts";
import {
  createLiveRefetchScheduler,
  type LiveRefetchScheduler,
} from "../hooks/live-refetch-scheduler.ts";
import type { LiveEventSubscriber } from "../sse/live-events.tsx";
import type { QueryPools, QuerySlot } from "./query-pool.ts";

export type QueryEntryState = {
  // undefined until the first success
  readonly data: unknown;
  readonly hasData: boolean;
  readonly error: DispatcherError | null;
  readonly loading: boolean;
  // true after the first success or non-abort error
  readonly settled: boolean;
};

export type QueryLoadMode = "mount" | "refetch" | "poll" | "live";

export type QueryHubRequest = {
  readonly type: string;
  readonly payload: unknown;
  readonly concurrency: number | undefined;
  readonly autoLoad: boolean;
};

export type QueryHub = {
  readonly subscribe: (key: string, request: QueryHubRequest, listener: () => void) => () => void;
  readonly getState: (key: string) => QueryEntryState | undefined;
  readonly load: (key: string, mode: QueryLoadMode) => Promise<void>;
  readonly watchLive: (
    key: string,
    subscribeLive: LiveEventSubscriber,
    liveEntities: readonly string[],
  ) => () => void;
};

type Run = {
  readonly ctrl: AbortController;
  // Only requests started in the same synchronous pass can be joined by a refetch.
  joinable: boolean;
  promise: Promise<void>;
};

type LiveWatch = {
  watchers: number;
  readonly scheduler: LiveRefetchScheduler;
  readonly unsubscribe: () => void;
};

type Entry = {
  readonly request: QueryHubRequest;
  state: QueryEntryState;
  readonly listeners: Set<() => void>;
  refCount: number;
  running: Run | undefined;
  live: LiveWatch | undefined;
};

const EMPTY_STATE: QueryEntryState = {
  data: undefined,
  hasData: false,
  error: null,
  loading: false,
  settled: false,
};

export function isValidConcurrency(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 1;
}

export function queryHubKey(type: string, payloadKey: string): string {
  return `${type}\n${payloadKey}`;
}

export function selectQueryData<TData>(
  state: QueryEntryState,
  resultField: string | undefined,
): TData | null {
  if (!state.hasData) return null;
  const value =
    resultField === undefined
      ? state.data
      : isRecord(state.data)
        ? state.data[resultField]
        : undefined;
  if (value === undefined || value === null) return null;
  return value as TData; // @cast-boundary engine-payload: hub caches untyped query results shared by hooks with different TData
}

export function createQueryHub(dispatcher: Dispatcher, pools: QueryPools): QueryHub {
  const entries = new Map<string, Entry>();

  function setState(entry: Entry, state: QueryEntryState): void {
    entry.state = state;
    for (const listener of [...entry.listeners]) listener();
  }

  async function execute(entry: Entry, run: Run): Promise<void> {
    const { ctrl } = run;
    const { type, payload, concurrency } = entry.request;
    let slot: QuerySlot | null = null;
    let result: QueryResult<unknown>;
    try {
      if (isValidConcurrency(concurrency)) {
        slot = await pools.acquire(type, Math.floor(concurrency), ctrl.signal);
        // skip: aborted while queued, the superseding run owns the state
        if (slot === null) return;
        // skip: slot granted just as the run was superseded, finally frees it
        if (ctrl.signal.aborted) return;
      }
      result = await dispatcher.query(type, payload, { signal: ctrl.signal });
    } finally {
      slot?.release();
      if (entry.running === run) entry.running = undefined;
    }
    // skip: a newer run already superseded this one, don't clobber its state
    if (ctrl.signal.aborted) return;
    if (result.isSuccess) {
      setState(entry, {
        data: result.data,
        hasData: true,
        error: null,
        loading: false,
        settled: true,
      });
      return;
    }
    // skip: a cancelled request, the newer run replaces this result
    if (result.error.code === "aborted") return;
    setState(entry, { ...entry.state, error: result.error, loading: false, settled: true });
  }

  function start(entry: Entry, background: boolean): Promise<void> {
    const run: Run = { ctrl: new AbortController(), joinable: true, promise: Promise.resolve() };
    entry.running = run;
    queueMicrotask(() => {
      run.joinable = false;
    });
    if (!background) setState(entry, { ...entry.state, loading: true });
    run.promise = execute(entry, run);
    return run.promise;
  }

  function load(key: string, mode: QueryLoadMode): Promise<void> {
    const entry = entries.get(key);
    if (entry === undefined) return Promise.resolve();
    const { running } = entry;
    if (running !== undefined) {
      if (mode === "mount" || mode === "poll") return running.promise;
      if (running.joinable) return running.promise;
      running.ctrl.abort();
    }
    const background =
      mode === "poll" || mode === "live" || (mode === "mount" && entry.state.hasData);
    return start(entry, background);
  }

  function release(key: string, entry: Entry): void {
    entry.refCount -= 1;
    if (entry.refCount > 0) return;
    // Deferred so StrictMode and a resubscribe on option change keep the entry.
    queueMicrotask(() => {
      if (entry.refCount > 0 || entries.get(key) !== entry) return;
      entry.running?.ctrl.abort();
      entry.live?.unsubscribe();
      entry.live?.scheduler.dispose();
      entry.live = undefined;
      entries.delete(key);
    });
  }

  return {
    subscribe(key, request, listener) {
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = {
          request,
          state: EMPTY_STATE,
          listeners: new Set(),
          refCount: 0,
          running: undefined,
          live: undefined,
        };
        entries.set(key, entry);
      }
      entry.refCount += 1;
      entry.listeners.add(listener);
      if (request.autoLoad) void load(key, "mount");
      const joined = entry;
      return () => {
        joined.listeners.delete(listener);
        release(key, joined);
      };
    },

    getState: (key) => entries.get(key)?.state,

    load,

    watchLive(key, subscribeLive, liveEntities) {
      const entry = entries.get(key);
      if (entry === undefined) return () => {};
      if (entry.live === undefined) {
        const scheduler = createLiveRefetchScheduler(() => load(key, "live"));
        entry.live = {
          watchers: 0,
          scheduler,
          unsubscribe: subscribeToEntities(subscribeLive, liveEntities, scheduler.trigger),
        };
      }
      const watch = entry.live;
      watch.watchers += 1;
      return () => {
        watch.watchers -= 1;
        if (watch.watchers > 0 || entry.live !== watch) return;
        watch.unsubscribe();
        watch.scheduler.dispose();
        entry.live = undefined;
      };
    },
  };
}
