// @runtime client
// DOM test for AuditLogScreen — asserts the table renders short ids and
// never the raw 36-character UUID (aggregate + actor columns).

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
import { AuditQueries } from "../constants";
import { AuditLogScreen } from "../web/audit-log-screen";
import { defaultTranslations } from "../web/i18n";

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

const AGGREGATE_ID = "aggregate-id-1234567890abcdef";
const CREATED_BY = "actor-id-0987654321fedcba";

function makeDispatcher(): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  const query = (async (type: string) => {
    if (type === AuditQueries.list) {
      return {
        isSuccess: true,
        data: {
          rows: [
            {
              id: "evt-1",
              aggregateId: AGGREGATE_ID,
              aggregateType: "task",
              type: "task.created",
              createdBy: CREATED_BY,
              createdAt: "2026-08-01T12:00:00.000Z",
              payload: {},
            },
          ],
          nextBefore: null,
        },
      };
    }
    return { isSuccess: true, data: null };
  }) as unknown as Dispatcher["query"];
  return {
    write: (async () => ({ isSuccess: true, data: {} })) as unknown as Dispatcher["write"],
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function renderScreen(): ReturnType<typeof render> {
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <NavProvider value={stubNav}>
            <LiveEventsProvider value={stubLiveEvents}>
              <DispatcherProvider dispatcher={makeDispatcher()}>{children}</DispatcherProvider>
            </LiveEventsProvider>
          </NavProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
  return render(<AuditLogScreen />, { wrapper });
}

describe("AuditLogScreen — id columns", () => {
  test("aggregate + actor cells show an 8-char short id, never the full UUID", async () => {
    const view = renderScreen();
    await waitFor(() => {
      if (view.queryByTestId("audit-log-table") === null) throw new Error("table not mounted");
    });

    const aggregateCell = view.getByTestId("cell-evt-1-aggregate");
    const actorCell = view.getByTestId("cell-evt-1-actor");

    expect(aggregateCell.textContent).toContain(AGGREGATE_ID.slice(0, 8));
    expect(actorCell.textContent).toBe(CREATED_BY.slice(0, 8));

    expect(aggregateCell.textContent).not.toContain(AGGREGATE_ID);
    expect(actorCell.textContent).not.toContain(CREATED_BY);
  });
});
