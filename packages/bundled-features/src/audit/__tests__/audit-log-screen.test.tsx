// @runtime client
// DOM test for AuditLogScreen actor-name resolution (#audit-log-actor-name).
// Provider wrapper is local — renderer-web → bundled-features forbids importing
// renderer-web test-utils from here.

import { describe, expect, test } from "bun:test";
import { createStore, type Dispatcher, type DispatcherStatus } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  type LiveEventSubscriber,
  LiveEventsProvider,
  LocaleProvider,
  type NavApi,
  NavProvider,
  PrimitivesProvider,
  TokensProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives, defaultTokens } from "@cosmicdrift/kumiko-renderer-web";
import { render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TenantQueries } from "../../tenant/constants";
import { AUDIT_LOG_DETAIL_SCREEN_ID, AuditQueries } from "../constants";
import { AuditLogDetailScreen } from "../web/audit-log-detail-screen";
import { AuditLogScreen } from "../web/audit-log-screen";
import { defaultTranslations } from "../web/i18n";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

const stubLiveEvents: LiveEventSubscriber = () => () => {};
const stubTokens = {
  tokens: defaultTokens,
  mode: "light" as const,
  setMode: () => {},
  toggleMode: () => {},
};
const stubResolver = createStaticLocaleResolver();
const stubNav: NavApi = {
  route: undefined,
  navigate: () => {},
  replace: () => {},
  hrefFor: (target) => {
    if (!("screenId" in target)) return "";
    return target.entityId !== undefined
      ? `/${target.screenId}/${target.entityId}`
      : `/${target.screenId}`;
  },
  searchParams: {},
  setSearchParams: () => {},
};

type AuditRowFixture = {
  readonly id: string;
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly type: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly payload: Record<string, unknown>;
};

type MemberRowFixture = {
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string | null;
};

const AUDIT_ROWS: readonly AuditRowFixture[] = [
  {
    id: "1",
    aggregateId: "agg-1",
    aggregateType: "widget",
    type: "widget.created",
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    payload: {},
  },
  {
    id: "2",
    aggregateId: "agg-2",
    aggregateType: "widget",
    type: "widget.updated",
    createdBy: "user-2",
    createdAt: "2026-08-02T00:00:00.000Z",
    payload: {},
  },
  {
    id: "3",
    aggregateId: "agg-3",
    aggregateType: "widget",
    type: "widget.deleted",
    createdBy: "user-missing",
    createdAt: "2026-08-03T00:00:00.000Z",
    payload: {},
  },
  {
    id: "4",
    aggregateId: "agg-4",
    aggregateType: "widget",
    type: "widget.synced",
    createdBy: "system",
    createdAt: "2026-08-04T00:00:00.000Z",
    payload: {},
  },
  {
    id: "5",
    aggregateId: "agg-5",
    aggregateType: "widget",
    type: "widget.archived",
    createdBy: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    createdAt: "2026-08-05T00:00:00.000Z",
    payload: {},
  },
];

const MEMBERS: readonly MemberRowFixture[] = [
  { userId: "user-1", email: "alice@example.com", displayName: "Alice Example" },
  { userId: "user-2", email: "bob@example.com", displayName: null },
];

type AuditDetailFixture = AuditRowFixture & { readonly metadata: Record<string, unknown> };

function detailFixtureFor(row: AuditRowFixture): AuditDetailFixture {
  return { ...row, metadata: {} };
}

type MembersResult =
  | { readonly isSuccess: true; readonly data: readonly MemberRowFixture[] }
  | { readonly isSuccess: false; readonly error: { readonly message: string } };

function makeDispatcher(
  options: {
    readonly detail?: AuditDetailFixture | null;
    readonly membersResult?: MembersResult;
  } = {},
): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  const query = (async (type: string) => {
    if (type === AuditQueries.list) {
      return { isSuccess: true, data: { rows: AUDIT_ROWS, nextBefore: null } };
    }
    if (type === AuditQueries.details) {
      return { isSuccess: true, data: options.detail ?? null };
    }
    if (type === TenantQueries.members) {
      return options.membersResult ?? { isSuccess: true, data: MEMBERS };
    }
    return { isSuccess: true, data: null };
  }) as unknown as Dispatcher["query"];
  return {
    write: (async () => ({ isSuccess: true, data: null })) as unknown as Dispatcher["write"],
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function renderWithProviders(
  ui: ReactNode,
  options: { readonly nav?: NavApi; readonly dispatcher?: Dispatcher } = {},
): ReturnType<typeof render> {
  const nav = options.nav ?? stubNav;
  const dispatcher = options.dispatcher ?? makeDispatcher();
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <NavProvider value={nav}>
            <LiveEventsProvider value={stubLiveEvents}>
              <DispatcherProvider dispatcher={dispatcher}>{children}</DispatcherProvider>
            </LiveEventsProvider>
          </NavProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
  return render(ui, { wrapper });
}

function renderScreen(dispatcher?: Dispatcher): ReturnType<typeof render> {
  return renderWithProviders(<AuditLogScreen />, { dispatcher });
}

function renderDetailScreen(entityId: string, dispatcher: Dispatcher): ReturnType<typeof render> {
  const nav: NavApi = { ...stubNav, route: { screenId: AUDIT_LOG_DETAIL_SCREEN_ID, entityId } };
  return renderWithProviders(<AuditLogDetailScreen />, { nav, dispatcher });
}

describe("AuditLogScreen — actor name resolution", () => {
  test("known member with displayName → cell shows the display name", async () => {
    const view = renderScreen();
    await waitFor(() => {
      const cell = view.queryByTestId("cell-1-actor");
      if (cell === null) throw new Error("actor cell not rendered yet");
    });
    expect(view.getByTestId("cell-1-actor").textContent).toBe("Alice Example");
  });

  test("known member without displayName → cell falls back to email", async () => {
    const view = renderScreen();
    await waitFor(() => {
      const cell = view.queryByTestId("cell-2-actor");
      if (cell === null) throw new Error("actor cell not rendered yet");
    });
    expect(view.getByTestId("cell-2-actor").textContent).toBe("bob@example.com");
  });

  test("createdBy not in members list → cell is empty, never the raw id", async () => {
    const view = renderScreen();
    await waitFor(() => {
      const cell = view.queryByTestId("cell-3-actor");
      if (cell === null) throw new Error("actor cell not rendered yet");
    });
    const cell = view.getByTestId("cell-3-actor");
    expect(cell.textContent).toBe("");
    expect(cell.textContent).not.toBe("user-missing");
  });

  test("table has no aggregate column", async () => {
    const view = renderScreen();
    await waitFor(() => {
      const cell = view.queryByTestId("cell-1-actor");
      if (cell === null) throw new Error("table not rendered yet");
    });
    expect(view.queryByTestId("cell-1-aggregate")).toBeNull();
    expect(view.container.textContent).not.toContain("agg-1");
  });

  test("createdBy is the system literal → cell shows the System label", async () => {
    const view = renderScreen();
    await waitFor(() => {
      const cell = view.queryByTestId("cell-4-actor");
      if (cell === null) throw new Error("actor cell not rendered yet");
    });
    expect(view.getByTestId("cell-4-actor").textContent).toBe("System");
  });

  test("createdBy is an unresolvable UUID → cell stays empty, raw UUID never rendered", async () => {
    const view = renderScreen();
    await waitFor(() => {
      const cell = view.queryByTestId("cell-5-actor");
      if (cell === null) throw new Error("actor cell not rendered yet");
    });
    const cell = view.getByTestId("cell-5-actor");
    expect(cell.textContent).toBe("");
    expect(view.container.textContent).not.toContain("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });
});

describe("AuditLogScreen — members query failure", () => {
  test("members query returns isSuccess:false → list still renders, no crash", async () => {
    const dispatcher = makeDispatcher({
      membersResult: { isSuccess: false, error: { message: "members unavailable" } },
    });
    const view = renderScreen(dispatcher);
    await waitFor(() => {
      const cell = view.queryByTestId("cell-1-type");
      if (cell === null) throw new Error("table not rendered yet");
    });
    expect(view.getByTestId("cell-1-type").textContent).toBe("widget.created");
    expect(view.getByTestId("cell-1-actor").textContent).toBe("");
  });
});

describe("AuditLogDetailScreen — actor name resolution", () => {
  test("known member with displayName → detail actor field shows the display name", async () => {
    const row = AUDIT_ROWS[0];
    if (row === undefined) throw new Error("fixture missing");
    const dispatcher = makeDispatcher({ detail: detailFixtureFor(row) });
    const view = renderDetailScreen(row.id, dispatcher);
    await waitFor(() => {
      const cell = view.queryByTestId("audit-detail-actor");
      if (cell === null) throw new Error("actor field not rendered yet");
    });
    expect(view.getByTestId("audit-detail-actor").textContent).toBe("Alice Example");
  });

  test("known member without displayName → detail actor field falls back to email", async () => {
    const row = AUDIT_ROWS[1];
    if (row === undefined) throw new Error("fixture missing");
    const dispatcher = makeDispatcher({ detail: detailFixtureFor(row) });
    const view = renderDetailScreen(row.id, dispatcher);
    await waitFor(() => {
      const cell = view.queryByTestId("audit-detail-actor");
      if (cell === null) throw new Error("actor field not rendered yet");
    });
    expect(view.getByTestId("audit-detail-actor").textContent).toBe("bob@example.com");
  });
});
