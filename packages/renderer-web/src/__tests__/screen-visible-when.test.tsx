import { describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  AppFeaturesProvider,
  DispatcherProvider,
  KumikoScreen,
  NavProvider,
  UserRolesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { PageHeaderSlotProvider } from "../layout/page-header-slot.js";
import { ShellHeader } from "../layout/shell-header.js";
import { createMockDispatcher, render, renderWithSidebar, screen, waitFor } from "./test-utils.js";

const GATE_QUERY = "billing:query:tier:status";
const OPEN = { openToAll: { reason: "test handler callable by any signed-in test user" } };

type GateOptions = { readonly fallback?: string };

function buildSchema({ fallback }: GateOptions): FeatureSchema {
  const gated: ScreenDefinition = {
    id: "channels",
    type: "projectionList",
    query: "billing:query:channel:list",
    columns: [{ field: "name", label: "billing.col.name" }],
    access: OPEN,
    visibleWhen: { query: GATE_QUERY, field: "chatAlertsAvailable", eq: true },
    ...(fallback !== undefined && { fallback }),
  };
  const upgrade: ScreenDefinition = {
    id: "upgrade",
    type: "projectionList",
    query: "billing:query:upgrade:list",
    columns: [{ field: "name", label: "billing.col.name" }],
    access: OPEN,
  };
  return { featureName: "billing", entities: {}, screens: [gated, upgrade] };
}

type GateResult =
  | { readonly kind: "data"; readonly available: boolean }
  | { readonly kind: "error" }
  | { readonly kind: "pending" };

function renderDirect(gate: GateResult, options: GateOptions = {}): { queryTypes: string[] } {
  const queryTypes: string[] = [];
  const schema = buildSchema(options);
  const dispatcher = createMockDispatcher({
    query: (async (type: string) => {
      queryTypes.push(type);
      if (type === GATE_QUERY) {
        if (gate.kind === "pending") return new Promise(() => undefined);
        if (gate.kind === "error") {
          return {
            isSuccess: false,
            error: { code: "internal", message: "kaputt", i18nKey: "errors.internal" },
          };
        }
        return { isSuccess: true, data: { chatAlertsAvailable: gate.available } };
      }
      const name = type === "billing:query:upgrade:list" ? "UPGRADE ROW" : "CHANNEL ROW";
      return { isSuccess: true, data: { rows: [{ id: "r1", name }], nextCursor: null } };
    }) as unknown as Dispatcher["query"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[schema]}>
        <UserRolesProvider roles={["User"]}>
          <KumikoScreen schema={schema} qn="billing:screen:channels" />
        </UserRolesProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>,
  );
  return { queryTypes };
}

describe("KumikoScreen visibleWhen (direct access)", () => {
  test("met condition renders the screen content", async () => {
    renderDirect({ kind: "data", available: true });
    await waitFor(() => expect(screen.getByText("CHANNEL ROW")).toBeTruthy());
    expect(screen.queryByTestId("kumiko-screen-unavailable")).toBeNull();
  });

  test("unmet condition without fallback shows the standard notice and never loads the content", async () => {
    const { queryTypes } = renderDirect({ kind: "data", available: false });
    await waitFor(() => expect(screen.getByTestId("kumiko-screen-unavailable")).toBeTruthy());
    expect(screen.queryByText("CHANNEL ROW")).toBeNull();
    expect(queryTypes).not.toContain("billing:query:channel:list");
  });

  test("unmet condition with fallback renders the fallback screen instead", async () => {
    const { queryTypes } = renderDirect(
      { kind: "data", available: false },
      { fallback: "upgrade" },
    );
    await waitFor(() => expect(screen.getByText("UPGRADE ROW")).toBeTruthy());
    expect(screen.queryByText("CHANNEL ROW")).toBeNull();
    expect(queryTypes).not.toContain("billing:query:channel:list");
  });

  test("while the gate query loads, no content and no notice render", () => {
    const { queryTypes } = renderDirect({ kind: "pending" });
    expect(screen.getByTestId("kumiko-screen-loading")).toBeTruthy();
    expect(screen.queryByTestId("kumiko-screen-unavailable")).toBeNull();
    expect(queryTypes).not.toContain("billing:query:channel:list");
  });

  test("a failing gate query is treated as unmet (fail-closed)", async () => {
    const { queryTypes } = renderDirect({ kind: "error" });
    await waitFor(() => expect(screen.getByTestId("kumiko-screen-unavailable")).toBeTruthy());
    expect(queryTypes).not.toContain("billing:query:channel:list");
  });
});

describe("KumikoScreen visibleWhen inside an app shell", () => {
  function renderInShell(available: boolean, options: GateOptions = {}): void {
    const schema: FeatureSchema = {
      ...buildSchema(options),
      navs: [{ id: "channels", label: "Channels", screen: "channels", order: 10 }],
    };
    const dispatcher = createMockDispatcher({
      query: (async (type: string) =>
        type === GATE_QUERY
          ? { isSuccess: true, data: { chatAlertsAvailable: available } }
          : {
              isSuccess: true,
              data: { rows: [{ id: "r1", name: "UPGRADE ROW" }], nextCursor: null },
            }) as unknown as Dispatcher["query"],
    });
    renderWithSidebar(
      <DispatcherProvider dispatcher={dispatcher}>
        <AppFeaturesProvider features={[schema]}>
          <UserRolesProvider roles={["User"]}>
            <NavProvider
              value={{
                route: { screenId: "channels" },
                navigate: () => {},
                replace: () => {},
                hrefFor: () => "",
                searchParams: {},
                setSearchParams: () => {},
              }}
            >
              <PageHeaderSlotProvider>
                <ShellHeader schema={schema} />
                <KumikoScreen schema={schema} qn="billing:screen:channels" />
              </PageHeaderSlotProvider>
            </NavProvider>
          </UserRolesProvider>
        </AppFeaturesProvider>
      </DispatcherProvider>,
    );
  }

  const crumbCount = (): number =>
    document.querySelectorAll("[data-slot='breadcrumb-item']").length;

  test("a met condition keeps the screen's breadcrumb", async () => {
    renderInShell(true);
    await waitFor(() => expect(screen.getByText("UPGRADE ROW")).toBeTruthy());
    expect(crumbCount()).toBe(1);
  });

  test("the fallback screen leaves no breadcrumb for the locked screen", async () => {
    renderInShell(false, { fallback: "upgrade" });
    await waitFor(() => expect(screen.getByText("UPGRADE ROW")).toBeTruthy());
    expect(crumbCount()).toBe(0);
  });

  test("the standard notice leaves no breadcrumb for the locked screen", async () => {
    renderInShell(false);
    await waitFor(() => expect(screen.getByTestId("kumiko-screen-unavailable")).toBeTruthy());
    expect(crumbCount()).toBe(0);
  });
});
