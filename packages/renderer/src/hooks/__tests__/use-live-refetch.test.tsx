import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppFeaturesProvider } from "../../app/app-features-context.tsx";
import type { FeatureSchema } from "../../app/feature-schema.ts";
import {
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../index.ts";
import { LIVE_REFETCH_COALESCE_MS } from "../live-refetch-scheduler.ts";
import { useLiveRefetch } from "../use-live-refetch.ts";

const QUERY = "graph:query:driver-node:list";

function createLiveFeed(): { subscribe: LiveEventSubscriber; emit: (entity: string) => void } {
  const listeners = new Map<string, Set<() => void>>();
  return {
    subscribe: (entity, listener) => {
      const set = listeners.get(entity) ?? new Set();
      listeners.set(entity, set);
      const wrapped = () =>
        listener({
          type: entity,
          data: {
            aggregateType: entity,
            eventType: LIVE_RESYNC_EVENT_TYPE,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        });
      set.add(wrapped);
      return () => set.delete(wrapped);
    },
    emit: (entity) => {
      for (const listener of listeners.get(entity) ?? []) listener();
    },
  };
}

const graphFeature: FeatureSchema = {
  featureName: "graph",
  entities: {},
  screens: [],
  queryLiveEntities: { [QUERY]: ["driverNode"] },
};

function renderLiveRefetch(options?: { readonly enabled?: boolean }) {
  let calls = 0;
  const refetch = () => {
    calls += 1;
  };
  const feed = createLiveFeed();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <AppFeaturesProvider features={[graphFeature]}>
      <LiveEventsProvider value={feed.subscribe}>{children}</LiveEventsProvider>
    </AppFeaturesProvider>
  );
  const { unmount } = renderHook(() => useLiveRefetch(QUERY, refetch, options), { wrapper });
  return { feed, unmount, calls: () => calls };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("useLiveRefetch", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("coalesces a burst of events of the projected entity into one refetch", async () => {
    const { feed, calls } = renderLiveRefetch();

    feed.emit("other");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(0);

    feed.emit("driverNode");
    feed.emit("driverNode");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(1);
  });

  test("enabled: false never refetches", async () => {
    const { feed, calls } = renderLiveRefetch({ enabled: false });

    feed.emit("driverNode");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(0);
  });

  test("stops refetching after unmount", async () => {
    const { feed, unmount, calls } = renderLiveRefetch();
    unmount();

    feed.emit("driverNode");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(0);
  });
});
