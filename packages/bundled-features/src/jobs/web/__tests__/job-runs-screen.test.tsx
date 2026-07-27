// @runtime client
// DOM test for JobRunsScreen trigger panel (#1602).
// Provider wrapper is local — renderer-web → bundled-features forbids importing
// renderer-web test-utils from here.

// CI runs this file in its own `bun test` process via `bun run test:dom:isolated`
// (excluded from shared bunfig.dom.toml) — same #457 happy-dom accumulation class
// as privacy-center / deletion-screens.

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
import { fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { JobHandlers, JobQueries } from "../../constants";
import { defaultTranslations } from "../i18n";
import { JobRunsScreen } from "../job-runs-screen";

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
  hrefFor: (target) =>
    target.entityId !== undefined
      ? `/${target.screenId}/${target.entityId}`
      : `/${target.screenId}`,
  searchParams: {},
  setSearchParams: () => {},
};

type CatalogRow = {
  readonly jobName: string;
  readonly perTenant: boolean;
  readonly payloadSchema: Record<string, unknown> | null;
};

type Fixture = {
  readonly catalogRows?: readonly CatalogRow[];
  readonly listRows?: readonly Record<string, unknown>[];
};

function makeDispatcher(
  fixture: Fixture,
  writes: Array<{ type: string; payload: unknown }>,
  queries: Array<{ type: string; payload: unknown }>,
): Dispatcher {
  const statusStore = createStore<DispatcherStatus>("online");
  const query = (async (type: string, payload: unknown) => {
    queries.push({ type, payload });
    if (type === JobQueries.catalog) {
      return { isSuccess: true, data: { rows: fixture.catalogRows ?? [] } };
    }
    if (type === JobQueries.list) {
      return { isSuccess: true, data: { rows: fixture.listRows ?? [] } };
    }
    return { isSuccess: true, data: null };
  }) as unknown as Dispatcher["query"];
  const write = (async (type: string, payload: unknown) => {
    writes.push({ type, payload });
    return {
      isSuccess: true,
      data: { jobName: (payload as { jobName: string }).jobName, bullJobId: "bull-1" },
    };
  }) as unknown as Dispatcher["write"];
  return {
    write,
    query,
    batch: (async () => ({ isSuccess: true, results: [] })) as unknown as Dispatcher["batch"],
    statusStore,
    async *stream() {},
    pendingWrites: () => [],
    pendingFiles: () => [],
  } as unknown as Dispatcher; // @cast-boundary test-stub
}

function renderScreen(fixture: Fixture = {}): {
  view: ReturnType<typeof render>;
  writes: Array<{ type: string; payload: unknown }>;
  queries: Array<{ type: string; payload: unknown }>;
} {
  const writes: Array<{ type: string; payload: unknown }> = [];
  const queries: Array<{ type: string; payload: unknown }> = [];
  const wrapper = ({ children }: { readonly children: ReactNode }): ReactNode => (
    <TokensProvider value={stubTokens}>
      <LocaleProvider
        resolver={stubResolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <PrimitivesProvider value={defaultPrimitives}>
          <NavProvider value={stubNav}>
            <LiveEventsProvider value={stubLiveEvents}>
              <DispatcherProvider dispatcher={makeDispatcher(fixture, writes, queries)}>
                {children}
              </DispatcherProvider>
            </LiveEventsProvider>
          </NavProvider>
        </PrimitivesProvider>
      </LocaleProvider>
    </TokensProvider>
  );
  return { view: render(<JobRunsScreen />, { wrapper }), writes, queries };
}

const REINDEX: CatalogRow = {
  jobName: "jobs:job:reindex-entity",
  perTenant: true,
  payloadSchema: {
    type: "object",
    properties: { entity: { type: "string" } },
    required: ["entity"],
  },
};

describe("JobRunsScreen — manual trigger panel", () => {
  test("loads catalog + list via QNs and renders translated trigger UI", async () => {
    const { view, queries } = renderScreen({ catalogRows: [REINDEX] });
    await waitFor(() => {
      if (view.queryByTestId("job-runs-screen") === null) throw new Error("not mounted");
    });
    expect(view.getByTestId("job-trigger-panel")).toBeTruthy();
    expect(view.getByTestId("job-trigger-form")).toBeTruthy();
    expect(view.container.textContent).not.toContain("jobs.trigger.");
    expect(view.container.textContent).not.toContain("jobs.runs.");

    await waitFor(() => {
      const catalogHit = queries.some((q) => q.type === JobQueries.catalog);
      const listHit = queries.some((q) => q.type === JobQueries.list);
      if (!catalogHit || !listHit) throw new Error("expected catalog + list queries");
    });
  });

  test("empty catalog shows empty copy, no form", async () => {
    const { view } = renderScreen({ catalogRows: [] });
    await waitFor(() => {
      if (view.queryByTestId("job-trigger-empty") === null) throw new Error("empty missing");
    });
    expect(view.queryByTestId("job-trigger-form")).toBeNull();
  });

  test("select job + JSON payload → jobs:write:trigger", async () => {
    const user = userEvent.setup();
    const { view, writes } = renderScreen({ catalogRows: [REINDEX] });
    await waitFor(() => {
      if (view.queryByTestId("job-trigger-form") === null) throw new Error("form missing");
    });

    await user.click(view.getByTestId("combobox-job-trigger-name"));
    const option = await view.findByText("jobs:job:reindex-entity");
    await user.click(option);

    await waitFor(() => {
      if (view.queryByTestId("job-trigger-per-tenant") === null) {
        throw new Error("perTenant hint missing");
      }
    });
    expect(view.getByTestId("job-trigger-schema-hint").textContent).toContain("entity");

    const payload = view.container.querySelector<HTMLTextAreaElement>("#job-trigger-payload");
    if (!payload) throw new Error("payload textarea missing");
    fireEvent.change(payload, { target: { value: '{"entity":"credit"}' } });

    await user.click(view.getByTestId("job-trigger-submit"));

    await waitFor(() => {
      if (writes.length === 0) throw new Error("no write yet");
    });
    expect(writes[0]).toEqual({
      type: JobHandlers.trigger,
      payload: { jobName: "jobs:job:reindex-entity", payload: { entity: "credit" } },
    });
    expect(view.getByTestId("job-trigger-success")).toBeTruthy();
  });

  test("invalid JSON payload → client error, no write", async () => {
    const user = userEvent.setup();
    const { view, writes } = renderScreen({ catalogRows: [REINDEX] });
    await waitFor(() => {
      if (view.queryByTestId("job-trigger-form") === null) throw new Error("form missing");
    });

    await user.click(view.getByTestId("combobox-job-trigger-name"));
    await user.click(await view.findByText("jobs:job:reindex-entity"));

    const payload = view.container.querySelector<HTMLTextAreaElement>("#job-trigger-payload");
    if (!payload) throw new Error("payload textarea missing");
    fireEvent.change(payload, { target: { value: "{not-json" } });
    await user.click(view.getByTestId("job-trigger-submit"));

    await waitFor(() => {
      if (view.queryByTestId("job-trigger-error") === null) throw new Error("error missing");
    });
    expect(writes).toEqual([]);
  });
});
