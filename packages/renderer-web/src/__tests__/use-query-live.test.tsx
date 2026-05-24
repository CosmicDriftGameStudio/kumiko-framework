import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  DispatcherProvider,
  type LiveEvent,
  type LiveEventSubscriber,
  LiveEventsProvider,
  useQuery,
} from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { describe, expect, test } from "bun:test";
import { act, createMockDispatcher, render, waitFor } from "./test-utils";

// Test-Helper: fake LiveEventSubscriber. Sammelt alle Subscriber, das
// Test kann `inject(type, data)` rufen um die matching listener zu
// feuern. Ersetzt die alten `__injectLiveEvent`-Seams aus dem
// Module-Singleton; jetzt lebt der Fake im Provider-Tree — identisch
// zum Production-Pattern.
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
        payload: {},
        createdAt: "",
      });
    });

    await waitFor(() => expect(getByTestId("probe").textContent).toBe("2"));
  });

  test("live=false: injected event wird ignoriert, kein refetch", async () => {
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
      payload: {},
      createdAt: "",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(getByTestId("probe").textContent).toBe("1");
    expect(calls).toBe(1);
  });

  test("live=true: nur events für die Query-Entity triggern refetch", async () => {
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

    // Event für andere Entity — kein refetch.
    fake.inject("note.created", {
      id: "n1",
      aggregateType: "note",
      version: 1,
      payload: {},
      createdAt: "",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });
});
