import { describe, expect, test } from "bun:test";
import { sleep } from "@cosmicdrift/kumiko-testing/helpers";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import {
  DispatcherProvider,
  type LiveEvent,
  type LiveEventSubscriber,
  LiveEventsProvider,
  useQuery,
} from "../../index.ts";
import { act, createMockDispatcher, render, waitFor } from "./test-utils.tsx";

// Fake LiveEventSubscriber for testing. It collects subscribers so the test can call
// `inject(type, data)` to trigger matching listeners. Unlike the old
// `__injectLiveEvent` seams in the module singleton, the fake lives in the provider
// tree, matching the production pattern.
function makeFakeLiveEvents(): {
  subscriber: LiveEventSubscriber;
  inject: (type: string, data: LiveEvent["data"]) => void;
} {
  const listeners = new Set<{ entity: string; cb: (e: LiveEvent) => void }>();
  return {
    subscriber: (entity, cb) => {
      const entry = { entity, cb };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    inject: (type, data) => {
      for (const l of listeners) {
        if (l.entity === data.aggregateType) l.cb({ type, data });
      }
    },
  };
}

function makeDispatcher(queryFn: Dispatcher["query"]): Dispatcher {
  return createMockDispatcher({ query: queryFn });
}

function Probe({ live }: { readonly live: boolean }): React.ReactElement {
  const q = useQuery<{ count: number }>("tasks:query:task:list", {}, { live });
  return <div data-testid="probe">{q.data?.count ?? "loading"}</div>;
}

function Wrapper({
  children,
  dispatcher,
  liveEvents,
}: {
  readonly children: ReactNode;
  readonly dispatcher: Dispatcher;
  readonly liveEvents: LiveEventSubscriber;
}): ReactNode {
  return (
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={liveEvents}>{children}</LiveEventsProvider>
    </DispatcherProvider>
  );
}

describe("useQuery live-mode", () => {
  test("live=true: injected event triggert refetch", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls += 1;
      return { isSuccess: true, data: { count: calls } };
    }) as unknown as Dispatcher["query"]);
    const fake = makeFakeLiveEvents();

    const { getByTestId } = render(
      <Wrapper dispatcher={dispatcher} liveEvents={fake.subscriber}>
        <Probe live={true} />
      </Wrapper>,
    );

    await waitFor(() => expect(getByTestId("probe").textContent).toBe("1"));

    act(() => {
      fake.inject("task.created", {
        id: "t1",
        aggregateType: "task",
        version: 1,
        eventType: "updated",
        createdAt: "",
      });
    });

    await waitFor(() => expect(getByTestId("probe").textContent).toBe("2"));
  });

  test("live=false: injected event is ignored, no refetch", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls += 1;
      return { isSuccess: true, data: { count: calls } };
    }) as unknown as Dispatcher["query"]);
    const fake = makeFakeLiveEvents();

    const { getByTestId } = render(
      <Wrapper dispatcher={dispatcher} liveEvents={fake.subscriber}>
        <Probe live={false} />
      </Wrapper>,
    );

    await waitFor(() => expect(getByTestId("probe").textContent).toBe("1"));

    fake.inject("task.created", {
      id: "t1",
      aggregateType: "task",
      version: 1,
      eventType: "updated",
      createdAt: "",
    });

    // Window for an unwanted second refetch; calls must stay at 1.
    await sleep(50);
    expect(getByTestId("probe").textContent).toBe("1");
    expect(calls).toBe(1);
  });

  test("live=true: only events for the query entity trigger refetch", async () => {
    let calls = 0;
    const dispatcher = makeDispatcher((async () => {
      calls += 1;
      return { isSuccess: true, data: { count: calls } };
    }) as unknown as Dispatcher["query"]);
    const fake = makeFakeLiveEvents();

    const { getByTestId } = render(
      <Wrapper dispatcher={dispatcher} liveEvents={fake.subscriber}>
        <Probe live={true} />
      </Wrapper>,
    );

    await waitFor(() => expect(getByTestId("probe").textContent).toBe("1"));

    // Event for another entity — no refetch.
    fake.inject("note.created", {
      id: "n1",
      aggregateType: "note",
      version: 1,
      eventType: "updated",
      createdAt: "",
    });

    // Window for a refetch the unrelated entity must not trigger.
    await sleep(50);
    expect(calls).toBe(1);
  });
});
