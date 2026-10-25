import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { AppFeaturesProvider } from "../../app/app-features-context.tsx";
import type { FeatureSchema } from "../../app/feature-schema.ts";
import { DispatcherProvider } from "../../context/dispatcher-context.tsx";
import type { Dispatcher } from "../../headless/index.ts";
import {
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../index.ts";
import { LIVE_REFETCH_COALESCE_MS } from "../live-refetch-scheduler.ts";
import { useQuery } from "../use-query.ts";

const QUERY = "content:query:banner:overview";

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

function renderLiveQuery(features: readonly FeatureSchema[] | undefined) {
  let calls = 0;
  const dispatcher = {
    query: async () => {
      calls += 1;
      return { isSuccess: true, data: { calls } };
    },
    statusStore: { getState: () => "online", subscribe: () => () => {} },
  } as unknown as Dispatcher;
  const feed = createLiveFeed();
  const wrapper = ({ children }: { readonly children: ReactNode }) => {
    const live = <LiveEventsProvider value={feed.subscribe}>{children}</LiveEventsProvider>;
    return (
      <DispatcherProvider dispatcher={dispatcher}>
        {features === undefined ? (
          live
        ) : (
          <AppFeaturesProvider features={features}>{live}</AppFeaturesProvider>
        )}
      </DispatcherProvider>
    );
  };
  renderHook(() => useQuery(QUERY, {}, { live: true }), { wrapper });
  return { feed, calls: () => calls };
}

const contentFeature: FeatureSchema = {
  featureName: "content",
  entities: {},
  screens: [],
  queryLiveEntities: { [QUERY]: ["bannerStat"] },
};

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("useQuery live subscriptions", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("an event of an entity only declared in liveEntities refetches", async () => {
    const { feed, calls } = renderLiveQuery([contentFeature]);
    await advance(0);
    expect(calls()).toBe(1);

    feed.emit("bannerStat");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(2);
  });

  test("the kebab-case aggregate type of a declared entity refetches too", async () => {
    const { feed, calls } = renderLiveQuery([contentFeature]);
    await advance(0);

    feed.emit("banner-stat");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(2);
  });

  test("the entity named in the query type keeps working alongside", async () => {
    const { feed, calls } = renderLiveQuery([contentFeature]);
    await advance(0);

    feed.emit("banner");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(2);
  });

  test("without app features only the entity from the query type is followed", async () => {
    const { feed, calls } = renderLiveQuery(undefined);
    await advance(0);

    feed.emit("bannerStat");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(1);

    feed.emit("banner");
    await advance(LIVE_REFETCH_COALESCE_MS);
    expect(calls()).toBe(2);
  });
});
