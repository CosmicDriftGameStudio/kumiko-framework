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
  within,
} from "../../__tests__/test-utils.tsx";
import { ShellFocusProvider } from "../shell-focus.tsx";
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
  extra: { readonly placement?: "header" | "overflow"; readonly headerActions?: ReactNode } = {},
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
          <ShellHeader
            schema={schema}
            user={user}
            {...(extra.placement !== undefined && { notificationBellPlacement: extra.placement })}
            {...(extra.headerActions !== undefined && { headerActions: extra.headerActions })}
          />
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

  test("a focused screen drops the bell but keeps the app's headerActions", () => {
    const nav = {
      route: undefined,
      navigate: () => {},
      replace: () => {},
      hrefFor: () => "",
      searchParams: {},
      setSearchParams: () => {},
    };
    renderWithSidebar(
      <DispatcherProvider dispatcher={makeDispatcher({ queries: [], writes: [] }, { count: 3 })}>
        <LiveEventsProvider value={makeLive().subscriber}>
          <NavProvider value={nav}>
            <ShellFocusProvider value={{ focused: true, register: () => () => {} }}>
              <ShellHeader
                schema={featureSchema("channel-in-app")}
                user={user}
                headerActions={<button type="button">Assistant</button>}
              />
            </ShellFocusProvider>
          </NavProvider>
        </LiveEventsProvider>
      </DispatcherProvider>,
    );
    expect(screen.getByRole("button", { name: "Assistant" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
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

  test("a delivered signal during loadMore drops the late older page instead of appending it", async () => {
    const live = makeLive();
    let olderRequested = false;
    let resolveOlder: (result: InAppInboxResult) => void = () => {};
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: { cursor?: string }) => {
        if (type === "channel-in-app:query:unread-count") {
          return { isSuccess: true, data: { count: 1 } };
        }
        if (payload.cursor !== undefined) {
          const older = await new Promise<InAppInboxResult>((resolve) => {
            olderRequested = true;
            resolveOlder = resolve;
          });
          return { isSuccess: true, data: older };
        }
        return { isSuccess: true, data: { ...inboxRows, nextCursor: "page-2" } };
      }) as unknown as Dispatcher["query"],
    });
    mount("channel-in-app", dispatcher, live.subscriber);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    await waitFor(() => expect(olderRequested).toBe(true));

    act(() => live.emit("channel-in-app:event:delivered"));
    const olderRow = { ...inboxRows.rows[1], id: 99, title: "Stale older row" };
    await act(async () => {
      resolveOlder({ total: 3, nextCursor: null, rows: [olderRow] } as InAppInboxResult);
    });

    expect(screen.queryByText("Stale older row")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  test("a delivered signal refetches the count", async () => {
    const calls: Calls = { queries: [], writes: [] };
    const unread = { count: 1 };
    const live = makeLive();
    mount("channel-in-app", makeDispatcher(calls, unread), live.subscriber);
    await screen.findByRole("button", { name: "Notifications, 1 unread" });

    unread.count = 4;
    act(() => live.emit("channel-in-app:event:delivered"));
    expect(await screen.findByRole("button", { name: "Notifications, 4 unread" })).toBeTruthy();
  });
});

describe("NotificationBell in the overflow menu", () => {
  const OVERFLOW = { placement: "overflow" } as const;

  test("no free bell: the menu holds an entry with the label and the unread count", async () => {
    mount(
      "channel-in-app",
      makeDispatcher({ queries: [], writes: [] }, { count: 3 }),
      makeLive().subscriber,
      [],
      featureSchema("channel-in-app"),
      OVERFLOW,
    );
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
    fireEvent.click(screen.getByTestId("shell-header-overflow-trigger"));
    const entry = await screen.findByTestId("notification-bell-menu-item");
    expect(entry.getAttribute("role")).toBe("menuitem");
    await waitFor(() => expect(entry.textContent).toBe("Notifications3"));
  });

  test("the entry opens the list, the entry's row navigates, and the list outlives the closing menu", async () => {
    const calls: Calls = { queries: [], writes: [] };
    const navigated: unknown[] = [];
    mount(
      "channel-in-app",
      makeDispatcher(calls, { count: 1 }),
      makeLive().subscriber,
      navigated,
      featureSchema("channel-in-app"),
      OVERFLOW,
    );
    fireEvent.click(screen.getByTestId("shell-header-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("notification-bell-menu-item"));

    expect(await screen.findByText("Printer is down")).toBeTruthy();
    expect(screen.getByTestId("shell-header-overflow").hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByText("Ticket assigned"));
    await waitFor(() => expect(navigated).toEqual([{ screenId: "detail", entityId: "t-7" }]));
    expect(calls.writes).toEqual([{ type: "channel-in-app:write:mark-read", payload: { id: 2 } }]);
  });

  test("closing the list returns the focus to the menu button", async () => {
    const calls: Calls = { queries: [], writes: [] };
    mount(
      "channel-in-app",
      makeDispatcher(calls, { count: 1 }),
      makeLive().subscriber,
      [],
      featureSchema("channel-in-app"),
      OVERFLOW,
    );
    fireEvent.click(screen.getByTestId("shell-header-overflow-trigger"));
    fireEvent.click(await screen.findByTestId("notification-bell-menu-item"));
    await screen.findByText("Printer is down");

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText("Printer is down")).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("shell-header-overflow-trigger"));
  });

  test("without the in-app channel there is neither an entry nor a menu", () => {
    mount(
      "showcase",
      makeDispatcher({ queries: [], writes: [] }, { count: 3 }),
      makeLive().subscriber,
      [],
      featureSchema("showcase"),
      OVERFLOW,
    );
    expect(screen.queryByTestId("shell-header-overflow-trigger")).toBeNull();
    expect(screen.queryByTestId("notification-bell-menu-item")).toBeNull();
  });

  test("from md the headerActions stay beside the menu and are not repeated in it", () => {
    mount(
      "channel-in-app",
      makeDispatcher({ queries: [], writes: [] }, { count: 0 }),
      makeLive().subscriber,
      [],
      featureSchema("channel-in-app"),
      { ...OVERFLOW, headerActions: <button type="button">Assistant</button> },
    );
    const header = document.querySelector('[data-kumiko-layout="header-actions"]');
    expect(header?.textContent).toBe("Assistant");
    expect(within(screen.getByTestId("shell-header-overflow")).queryByText("Assistant")).toBeNull();
  });
});
