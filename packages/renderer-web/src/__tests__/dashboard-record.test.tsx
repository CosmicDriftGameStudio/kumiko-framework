import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
} from "@cosmicdrift/kumiko-renderer";
import { act, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const NOW_MS = Date.UTC(2026, 9, 19, 12, 0, 0);

const STAT_QUERY = "status:query:monitor:stat";
const RECORD_QUERY = "status:query:monitor:detail";

const panels: DashboardScreenDefinition["panels"] = [
  {
    kind: "stat",
    id: "uptime",
    label: "status:dashboard:uptime",
    query: STAT_QUERY,
    valueField: "value",
  },
];

function schemaOf(screenOverrides: Partial<DashboardScreenDefinition>): FeatureSchema {
  const dashboard: DashboardScreenDefinition = {
    id: "monitor",
    type: "dashboard",
    panels,
    showUpdatedAt: false,
    ...screenOverrides,
  };
  return { featureName: "status", entities: {}, screens: [dashboard] };
}

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

type Call = { readonly type: string; readonly payload: unknown };

function mountDashboard(
  schema: FeatureSchema,
  handlers: {
    readonly query?: (type: string, payload: unknown) => Record<string, unknown>;
    readonly write?: (type: string, payload: unknown) => void;
  } = {},
): { readonly queries: Call[]; readonly writes: Call[] } {
  const queries: Call[] = [];
  const writes: Call[] = [];
  const dispatcher = createMockDispatcher({
    query: (async (type: string, payload: unknown) => {
      queries.push({ type, payload });
      return { isSuccess: true, data: handlers.query?.(type, payload) ?? { value: "ok" } };
    }) as unknown as Dispatcher["query"],
    write: (async (type: string, payload: unknown) => {
      writes.push({ type, payload });
      handlers.write?.(type, payload);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
  render(
    <BrowserNav>
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={schema} qn="status:screen:monitor" />
        </DashboardBodyProvider>
      </DispatcherProvider>
    </BrowserNav>,
  );
  return { queries, writes };
}

const countOf = (calls: readonly Call[], type: string): number =>
  calls.filter((call) => call.type === type).length;

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("dashboard record binding", () => {
  test("the record id from the URL lands in every panel payload", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    const { queries } = mountDashboard(schemaOf({ record: { param: "monitorId" } }));
    await waitFor(() => expect(screen.getByText("ok")).toBeTruthy());
    expect(queries.find((c) => c.type === STAT_QUERY)?.payload).toEqual({ monitorId: "m-1" });
  });

  test("payloadKey renames the key, panel params win over the record key", async () => {
    window.history.replaceState(null, "", "/monitor?m=m-1");
    const { queries } = mountDashboard(
      schemaOf({
        record: { param: "m", payloadKey: "monitorId" },
        panels: [
          {
            ...panels[0],
            params: { monitorId: "pinned" },
          } as DashboardScreenDefinition["panels"][number],
        ],
      }),
    );
    await waitFor(() => expect(screen.getByText("ok")).toBeTruthy());
    expect(queries.find((c) => c.type === STAT_QUERY)?.payload).toEqual({ monitorId: "pinned" });
  });

  test("a missing param shows the hint and runs no query", async () => {
    const { queries } = mountDashboard(
      schemaOf({ record: { param: "monitorId", query: RECORD_QUERY } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-monitor-record-missing")).toBeTruthy(),
    );
    expect(queries).toEqual([]);
  });

  test("record.query row supplies the title", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    const { queries } = mountDashboard(
      schemaOf({ record: { param: "monitorId", query: RECORD_QUERY, titleField: "name" } }),
      {
        query: (type) =>
          type === RECORD_QUERY ? { id: "m-1", name: "API monitor" } : { value: "ok" },
      },
    );
    await waitFor(() => expect(screen.getByText("API monitor")).toBeTruthy());
    expect(queries.find((c) => c.type === RECORD_QUERY)?.payload).toEqual({ monitorId: "m-1" });
  });

  test("a header action dispatches with the record row and refetches record and panels", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    const { queries, writes } = mountDashboard(
      schemaOf({
        record: { param: "monitorId", query: RECORD_QUERY },
        actions: [
          {
            kind: "writeHandler",
            id: "check-now",
            label: "Check now",
            handler: "status:write:monitor:check-now",
          },
        ],
      }),
      { query: (type) => (type === RECORD_QUERY ? { id: "m-1", name: "API" } : { value: "ok" }) },
    );
    const button = await screen.findByText("Check now");
    const recordBefore = countOf(queries, RECORD_QUERY);
    const panelBefore = countOf(queries, STAT_QUERY);
    fireEvent.click(button);
    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]).toEqual({
      type: "status:write:monitor:check-now",
      payload: { id: "m-1" },
    });
    await waitFor(() => {
      expect(countOf(queries, RECORD_QUERY)).toBeGreaterThan(recordBefore);
      expect(countOf(queries, STAT_QUERY)).toBeGreaterThan(panelBefore);
    });
  });

  test("without record.query the action row is the id only", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    const { writes } = mountDashboard(
      schemaOf({
        record: { param: "monitorId" },
        actions: [
          { kind: "writeHandler", id: "go", label: "Go", handler: "status:write:monitor:go" },
        ],
      }),
    );
    fireEvent.click(await screen.findByText("Go"));
    await waitFor(() => expect(writes.length).toBe(1));
    expect(writes[0]?.payload).toEqual({ id: "m-1" });
  });
});

describe("dashboard refresh and relative time", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    jest.useRealTimers();
    setSystemTime();
  });

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
  }

  test("refresh seconds refetches the panels on every tick", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    const { queries } = mountDashboard(
      schemaOf({ record: { param: "monitorId" }, refresh: { seconds: 10 } }),
    );
    await advance(0);
    const initial = countOf(queries, STAT_QUERY);
    expect(initial).toBeGreaterThan(0);
    await advance(10_000);
    expect(countOf(queries, STAT_QUERY)).toBe(initial + 1);
    await advance(10_000);
    expect(countOf(queries, STAT_QUERY)).toBe(initial + 2);
  });

  test("refresh field reads the interval from the record row, clamped to 5 s", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    const { queries } = mountDashboard(
      schemaOf({
        record: { param: "monitorId", query: RECORD_QUERY },
        refresh: { field: "intervalSeconds" },
      }),
      {
        query: (type) =>
          type === RECORD_QUERY ? { id: "m-1", intervalSeconds: 1 } : { value: "ok" },
      },
    );
    await advance(0);
    await advance(0);
    const initial = countOf(queries, STAT_QUERY);
    await advance(4_000);
    expect(countOf(queries, STAT_QUERY)).toBe(initial);
    await advance(1_000);
    expect(countOf(queries, STAT_QUERY)).toBe(initial + 1);
  });

  test("polling stops after unmount", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    const { queries } = mountDashboard(
      schemaOf({ record: { param: "monitorId" }, refresh: { seconds: 5 } }),
    );
    await advance(0);
    cleanup();
    const before = countOf(queries, STAT_QUERY);
    await advance(30_000);
    expect(countOf(queries, STAT_QUERY)).toBe(before);
  });

  test("a relativeTime stat ticks with the clock while mounted", async () => {
    window.history.replaceState(null, "", "/monitor?monitorId=m-1");
    mountDashboard(
      schemaOf({
        record: { param: "monitorId" },
        panels: [
          {
            kind: "stat",
            id: "last-check",
            label: "status:dashboard:last-check",
            query: STAT_QUERY,
            valueField: "at",
            valueFormat: { kind: "relativeTime" },
          },
        ],
      }),
      { query: () => ({ at: NOW_MS - 5_000 }) },
    );
    await advance(0);
    await advance(0);
    expect(screen.getByText("5 seconds ago")).toBeTruthy();
    await advance(5_000);
    expect(screen.getByText("10 seconds ago")).toBeTruthy();
  });
});
