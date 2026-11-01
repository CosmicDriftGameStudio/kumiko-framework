import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import {
  PRESENCE_CHANGED_EVENT,
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  PRESENCE_WRITES,
  type PresenceEntry,
} from "@cosmicdrift/kumiko-types/presence-types";
import type { ReactElement, ReactNode } from "react";
import type { Dispatcher, WriteResult } from "../../../headless/index.ts";
import {
  DispatcherProvider,
  type LiveEvent,
  type LiveEventSubscriber,
  LiveEventsProvider,
} from "../../../index.ts";
import { act, cleanup, createMockDispatcher, render, screen } from "../../__tests__/test-utils.tsx";
import { PresenceAvatars } from "../presence-avatars.tsx";
import { PresenceNotice } from "../presence-notice.tsx";
import { usePresence } from "../use-presence.ts";

const NOW = Date.parse("2026-11-01T10:10:00.000Z");

function entry(name: string, overrides: Partial<PresenceEntry> = {}): PresenceEntry {
  return {
    userId: `id-${name}`,
    displayName: name,
    activity: "viewing",
    since: new Date(NOW - 3 * 60_000).toISOString(),
    ...overrides,
  };
}

afterEach(cleanup);

describe("PresenceNotice", () => {
  test("names the person, the default text and how long they have been there", () => {
    render(<PresenceNotice entries={[entry("Ada")]} nowMs={NOW} />);
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Ada");
    expect(notice.textContent).toContain("is looking at this right now");
    expect(notice.textContent).toContain("for 3 min");
    expect(notice.querySelector("strong")?.textContent).toBe("Ada");
  });

  test("an editor reads as editing", () => {
    render(<PresenceNotice entries={[entry("Ada", { activity: "editing" })]} nowMs={NOW} />);
    expect(screen.getByRole("status").textContent).toContain("is editing this right now");
  });

  test("under a minute reads as just now", () => {
    const since = new Date(NOW - 20_000).toISOString();
    render(<PresenceNotice entries={[entry("Ada", { since })]} nowMs={NOW} />);
    expect(screen.getByRole("status").textContent).toContain("just now");
  });

  test("several people show the first and the count of the rest", () => {
    const { rerender } = render(
      <PresenceNotice entries={[entry("Ada"), entry("Bob")]} nowMs={NOW} />,
    );
    expect(screen.getByRole("status").textContent).toContain("and 1 other person");
    rerender(<PresenceNotice entries={[entry("Ada"), entry("Bob"), entry("Cy")]} nowMs={NOW} />);
    expect(screen.getByRole("status").textContent).toContain("and 2 others");
  });

  test("describe replaces the default text", () => {
    render(
      <PresenceNotice
        entries={[entry("Ada")]}
        nowMs={NOW}
        describe={(item) => `is reading ${item.focus ?? "all of it"}`}
      />,
    );
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("is reading all of it");
    expect(text).not.toContain("looking at this");
  });

  test("an empty list renders nothing", () => {
    const { container } = render(<PresenceNotice entries={[]} nowMs={NOW} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("PresenceAvatars", () => {
  test("shows up to max avatars and counts the rest", () => {
    render(
      <PresenceAvatars
        entries={[entry("Ada"), entry("Bob"), entry("Cy"), entry("Dee"), entry("Eve")]}
        max={3}
      />,
    );
    const group = screen.getByTitle(/Also here/);
    expect(group.querySelectorAll('[role="img"]')).toHaveLength(3);
    expect(group.textContent).toContain("+2");
    expect(group.getAttribute("title")).toBe("Also here: Ada, Bob, Cy, Dee, Eve");
  });

  test("an empty list renders nothing", () => {
    const { container } = render(<PresenceAvatars entries={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

type Write = { readonly type: string; readonly payload: unknown };

function setup(answer: (type: string) => WriteResult) {
  const writes: Write[] = [];
  const listeners = new Set<(event: LiveEvent) => void>();
  const subscriber: LiveEventSubscriber = (key, listener) => {
    if (key !== PRESENCE_CHANGED_EVENT) return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const dispatcher: Dispatcher = createMockDispatcher({
    write: (async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      return answer(type);
    }) as unknown as Dispatcher["write"],
  });
  const tree = (ui: ReactElement): ReactElement => (
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={subscriber}>{ui}</LiveEventsProvider>
    </DispatcherProvider>
  );
  const mount = (ui: ReactElement) => {
    const view = render(tree(ui));
    return { unmount: view.unmount, rerender: (next: ReactElement) => view.rerender(tree(next)) };
  };
  const emit = (data: Record<string, unknown>): void => {
    for (const listener of listeners) {
      listener({ type: PRESENCE_CHANGED_EVENT, data } as unknown as LiveEvent); // test frame: server frames carry no aggregateType
    }
  };
  return { writes, mount, emit };
}

function Probe(props: { activity: "viewing" | "editing"; id?: string }): ReactNode {
  const { others } = usePresence({ entity: "doc", id: props.id ?? "d1", activity: props.activity });
  return <output>{others.map((other) => other.displayName).join(",")}</output>;
}

const heartbeats = (writes: readonly Write[]) =>
  writes.filter((write) => write.type === PRESENCE_WRITES.heartbeat);
const leaves = (writes: readonly Write[]) =>
  writes.filter((write) => write.type === PRESENCE_WRITES.leave);

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("usePresence", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("beats on mount and every 15 seconds, shows the others and leaves on unmount", async () => {
    const { writes, mount } = setup(() => ({
      isSuccess: true,
      data: { others: [entry("Ada")] },
    }));
    const { unmount } = mount(<Probe activity="viewing" />);
    await flush();
    expect(heartbeats(writes)).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("Ada");

    await act(async () => {
      jest.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS);
    });
    expect(heartbeats(writes)).toHaveLength(2);

    unmount();
    expect(leaves(writes)).toEqual([
      { type: PRESENCE_WRITES.leave, payload: { entity: "doc", id: "d1" } },
    ]);
    await act(async () => {
      jest.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS * 2);
    });
    expect(heartbeats(writes)).toHaveLength(2);
  });

  test("a changed activity beats right away without leaving", async () => {
    const { writes, mount } = setup(() => ({ isSuccess: true, data: { others: [] } }));
    const { rerender } = mount(<Probe activity="viewing" />);
    await flush();
    rerender(<Probe activity="editing" />);
    await flush();
    expect(
      heartbeats(writes).map((write) => (write.payload as { activity: string }).activity),
    ).toEqual(["viewing", "editing"]);
    expect(leaves(writes)).toHaveLength(0);
  });

  test("another record leaves the old one and beats for the new one", async () => {
    const { writes, mount } = setup(() => ({ isSuccess: true, data: { others: [] } }));
    const { rerender } = mount(<Probe activity="viewing" id="d1" />);
    await flush();
    rerender(<Probe activity="viewing" id="d2" />);
    await flush();
    expect(leaves(writes).map((write) => write.payload)).toEqual([{ entity: "doc", id: "d1" }]);
    expect(heartbeats(writes).map((write) => (write.payload as { id: string }).id)).toEqual([
      "d1",
      "d2",
    ]);
  });

  test("a live signal for the record beats again, one for another record does not", async () => {
    const { writes, mount, emit } = setup(() => ({ isSuccess: true, data: { others: [] } }));
    mount(<Probe activity="viewing" />);
    await flush();
    emit({ userId: "me", entity: "doc", id: "other-row" });
    await flush();
    expect(heartbeats(writes)).toHaveLength(1);
    emit({ userId: "me", entity: "doc", id: "d1" });
    await flush();
    expect(heartbeats(writes)).toHaveLength(2);
  });

  test("a 404 (feature not mounted or row off limits) goes quiet: no more beats, no leave", async () => {
    const { writes, mount } = setup(() => ({
      isSuccess: false,
      error: { code: "not_found", httpStatus: 404, i18nKey: "errors.not_found", message: "nope" },
    }));
    const { unmount } = mount(<Probe activity="viewing" />);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS * 4);
    });
    expect(heartbeats(writes)).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe("");
    unmount();
    expect(leaves(writes)).toHaveLength(0);
  });

  test("a network failure keeps beating on the normal cadence", async () => {
    const { writes, mount } = setup(() => ({
      isSuccess: false,
      error: {
        code: "network_error",
        httpStatus: 0,
        i18nKey: "dispatcher.errors.network",
        message: "off",
      },
    }));
    mount(<Probe activity="viewing" />);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL_MS);
    });
    expect(heartbeats(writes)).toHaveLength(2);
  });
});
