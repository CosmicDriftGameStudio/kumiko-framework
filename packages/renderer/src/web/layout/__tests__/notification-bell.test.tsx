import { describe, expect, test } from "bun:test";
import type { InAppInboxResult } from "@cosmicdrift/kumiko-types/in-app-notification-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../../headless/index.ts";
import {
  type AppSchema,
  DispatcherProvider,
  type FeatureSchema,
  type LiveEvent,
  type LiveEventSubscriber,
  LiveEventsProvider,
  NavProvider,
} from "../../../index.ts";
import {
  act,
  createMockDispatcher,
  fireEvent,
  renderWithSidebar,
  screen,
  waitFor,
} from "../../__tests__/test-utils.tsx";
import { ShellHeader } from "../shell-header.tsx";

const user = { id: "u1", roles: ["User"] };

function featureSchema(name: string, screenId = "tickets:screen:detail"): FeatureSchema {
  return {
    featureName: name,
    entities: {},
    screens: [{ id: screenId, type: "entityList", entity: "x", columns: [] }],
    navs: [],
  } as unknown as FeatureSchema;
}

const inboxRows: InAppInboxResult = {
  total: 2,
  nextCursor: null,
  rows: [
    {
      id: 2,
      notificationType: "t:notify:a",
      title: "Ticket assigned",
      body: "Printer is down",
      isRead: false,
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      target: { screenId: "tickets:screen:detail", entityId: "t-7" },
    },
    {
      id: 1,
      notificationType: "t:notify:b",
      title: "Welcome",
      body: null,
      isRead: true,
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      target: null,
    },
  ],
};

type Calls = { queries: string[]; writes: Array<{ type: string; payload: unknown }> };

function makeDispatcher(calls: Calls, unread: { count: number }): Dispatcher {
  return createMockDispatcher({
    query: (async (type: string) => {
      calls.queries.push(type);
      if (type === "channel-in-app:query:unread-count") {
        return { isSuccess: true, data: { count: unread.count } };
      }
      return { isSuccess: true, data: inboxRows };
    }) as unknown as Dispatcher["query"],
    write: (async (type: string, payload: unknown) => {
      calls.writes.push({ type, payload });
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
}

function makeLive(): { subscriber: LiveEventSubscriber; emit: (type: string) => void } {
  const listeners = new Set<{ key: string; cb: (e: LiveEvent) => void }>();
  return {
    subscriber: (key, cb) => {
      const entry = { key, cb };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    emit: (type) => {
      for (const l of listeners) {
        if (l.key === type) {
          l.cb({
            type,
            data: { aggregateType: type, eventType: type, createdAt: new Date().toISOString() },
          });
        }
      }
    },
  };
}

function mount(
  featureName: string,
  dispatcher: Dispatcher,
  live: LiveEventSubscriber,
  navigated: Array<unknown> = [],
  schema: AppSchema | FeatureSchema = featureSchema(featureName),
): void {
  const nav = {
    route: undefined,
    navigate: (target: unknown) => navigated.push(target),
    replace: () => {},
    hrefFor: () => "",
    searchParams: {},
    setSearchParams: () => {},
  };
  const tree: ReactNode = (
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={live}>
        <NavProvider value={nav}>
          <ShellHeader schema={schema} user={user} />
        </NavProvider>
      </LiveEventsProvider>
    </DispatcherProvider>
  );
  renderWithSidebar(tree);
}

describe("NotificationBell", () => {
  test("shows no bell without the channel-in-app feature", () => {
    const calls: Calls = { queries: [], writes: [] };
    mount("showcase", makeDispatcher(calls, { count: 3 }), makeLive().subscriber);
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
    expect(calls.queries).toEqual([]);
  });

  test("shows the unread count in a badge and in the accessible name", async () => {
    mount(
      "channel-in-app",
      makeDispatcher({ queries: [], writes: [] }, { count: 3 }),
      makeLive().subscriber,
    );
    const bell = await screen.findByRole("button", { name: "Notifications, 3 unread" });
    await waitFor(() => expect(bell.textContent).toBe("3"));
  });

  test("caps the badge at 99+", async () => {
    mount(
      "channel-in-app",
      makeDispatcher({ queries: [], writes: [] }, { count: 150 }),
      makeLive().subscriber,
    );
    const bell = await screen.findByRole("button", { name: "Notifications, 99+ unread" });
    expect(bell.textContent).toBe("99+");
  });

  test("lists the notifications and an entry click marks it read and navigates to its target", async () => {
    const calls: Calls = { queries: [], writes: [] };
    const navigated: unknown[] = [];
    mount("channel-in-app", makeDispatcher(calls, { count: 1 }), makeLive().subscriber, navigated);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    expect(await screen.findByText("Printer is down")).toBeTruthy();
    expect(screen.getByText("Welcome")).toBeTruthy();

    fireEvent.click(screen.getByText("Ticket assigned"));
    await waitFor(() => expect(navigated).toEqual([{ screenId: "detail", entityId: "t-7" }]));
    expect(calls.writes).toEqual([{ type: "channel-in-app:write:mark-read", payload: { id: 2 } }]);
  });

  test("a target whose feature has no such screen is not opened, even if another feature has a screen of that short name", async () => {
    const calls: Calls = { queries: [], writes: [] };
    const navigated: unknown[] = [];
    const schema: AppSchema = {
      features: [
        { ...featureSchema("channel-in-app"), screens: [] },
        featureSchema("crm", "crm:screen:detail"),
        featureSchema("shop", "shop:screen:detail"),
      ],
    };
    mount(
      "channel-in-app",
      makeDispatcher(calls, { count: 1 }),
      makeLive().subscriber,
      navigated,
      schema,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(await screen.findByText("Ticket assigned"));
    await waitFor(() =>
      expect(calls.writes).toEqual([
        { type: "channel-in-app:write:mark-read", payload: { id: 2 } },
      ]),
    );
    expect(navigated).toEqual([]);
  });

  test("a delivered signal refetches the count", async () => {
    const calls: Calls = { queries: [], writes: [] };
    const unread = { count: 1 };
    const live = makeLive();
    mount("channel-in-app", makeDispatcher(calls, unread), live.subscriber);
    await screen.findByRole("button", { name: "Notifications, 1 unread" });

    unread.count = 4;
    act(() => live.emit("channel-in-app:event:delivered"));
    await screen.findByRole("button", { name: "Notifications, 4 unread" });
  });
});
