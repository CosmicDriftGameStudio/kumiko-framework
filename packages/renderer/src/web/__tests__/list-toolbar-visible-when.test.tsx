// Toolbar actions of a projectionList gated by a query: shown only while the query answers
// with a match (live), hidden while it loads and when it fails.

import { describe, expect, test } from "bun:test";
import type { ProjectionListScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  DispatcherProvider,
  KumikoScreen,
  type LiveEventSubscriber,
  LiveEventsProvider,
  UserRolesProvider,
} from "../../index.ts";
import { act, createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const GATE_QUERY = "shop:query:quota:status";
const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

const listScreen: ProjectionListScreenDefinition = {
  id: "items",
  type: "projectionList",
  query: "shop:query:item:list",
  columns: [{ field: "name", label: "shop.col.name" }],
  access: OPEN,
  toolbarActions: [
    {
      kind: "writeHandler",
      id: "import",
      label: "Import",
      handler: "shop:write:item:import",
      visibleWhen: { query: GATE_QUERY, field: "canCreate", eq: true },
    },
    {
      kind: "writeHandler",
      id: "bulk-import",
      label: "Bulk import",
      handler: "shop:write:item:bulk-import",
      visibleWhen: { query: GATE_QUERY, field: "canCreate", eq: true },
    },
    { kind: "writeHandler", id: "export", label: "Export", handler: "shop:write:item:export" },
  ],
};

const schema: FeatureSchema = { featureName: "shop", entities: {}, screens: [listScreen] };

type Gate = { canCreate: boolean } | "error";

function renderList(initial: Gate): {
  readonly gateCalls: () => number;
  readonly setGate: (next: Gate) => Promise<void>;
} {
  let gate = initial;
  let gateCalls = 0;
  let fireLiveEvent: (() => void) | undefined;
  const subscribe: LiveEventSubscriber = (entity, listener) => {
    if (entity !== "quota") return () => {};
    fireLiveEvent = () =>
      listener({
        type: "event",
        data: { aggregateType: "quota", eventType: "updated", createdAt: "2026-01-01T00:00:00Z" },
      });
    return () => {};
  };
  const dispatcher = createMockDispatcher({
    query: (async (type: string) => {
      if (type !== GATE_QUERY) {
        return {
          isSuccess: true,
          data: { rows: [{ id: "r1", name: "ROW ONE" }], nextCursor: null },
        };
      }
      gateCalls++;
      return gate === "error"
        ? {
            isSuccess: false,
            error: { code: "internal", message: "kaputt", i18nKey: "errors.internal" },
          }
        : { isSuccess: true, data: gate };
    }) as unknown as Dispatcher["query"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <LiveEventsProvider value={subscribe}>
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={["User"]}>
            <KumikoScreen schema={schema} qn="shop:screen:items" />
          </UserRolesProvider>
        </AppFeaturesProvider>
      </LiveEventsProvider>
    </DispatcherProvider>,
  );
  return {
    gateCalls: () => gateCalls,
    setGate: async (next) => {
      gate = next;
      await act(async () => {
        fireLiveEvent?.();
      });
    },
  };
}

const importButton = (): HTMLElement | null =>
  screen.queryByTestId("render-list-toolbar-action-import");

describe("projectionList toolbar action visibleWhen", () => {
  test("shows the gated buttons on a match and asks the shared gate query once", async () => {
    const { gateCalls } = renderList({ canCreate: true });
    await waitFor(() => expect(importButton()).not.toBeNull());
    expect(screen.queryByTestId("render-list-toolbar-action-bulk-import")).not.toBeNull();
    expect(screen.queryByTestId("render-list-toolbar-action-export")).not.toBeNull();
    expect(gateCalls()).toBe(1);
  });

  test("hides only the gated buttons when the condition is not met", async () => {
    renderList({ canCreate: false });
    await waitFor(() =>
      expect(screen.queryByTestId("render-list-toolbar-action-export")).not.toBeNull(),
    );
    expect(importButton()).toBeNull();
    expect(screen.queryByTestId("render-list-toolbar-action-bulk-import")).toBeNull();
  });

  test("hides the gated buttons when the gate query fails", async () => {
    const { gateCalls } = renderList("error");
    await waitFor(() => expect(gateCalls()).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.queryByTestId("render-list-toolbar-action-export")).not.toBeNull(),
    );
    expect(importButton()).toBeNull();
  });

  test("a live refetch flips the buttons in and out", async () => {
    const { setGate } = renderList({ canCreate: false });
    await waitFor(() =>
      expect(screen.queryByTestId("render-list-toolbar-action-export")).not.toBeNull(),
    );
    expect(importButton()).toBeNull();

    await setGate({ canCreate: true });
    await waitFor(() => expect(importButton()).not.toBeNull());

    await setGate({ canCreate: false });
    await waitFor(() => expect(importButton()).toBeNull());
  });
});
