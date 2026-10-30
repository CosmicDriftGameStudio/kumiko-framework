import { afterEach, describe, expect, test } from "bun:test";
import type { DashboardScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type { ExtensionSectionProps, FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  DashboardBodyProvider,
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
  NavProvider,
  UserRolesProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { act, createMockDispatcher, render, screen, waitFor, within } from "./test-utils.tsx";

const dashboardScreen: DashboardScreenDefinition = {
  id: "overview",
  type: "dashboard",
  panels: [
    {
      kind: "stat",
      id: "uptime",
      label: "status:dashboard:uptime",
      query: "status:query:monitor:uptime-stat",
      valueField: "value",
      subField: "sub",
      toneField: "tone",
    },
    {
      kind: "list",
      id: "latest",
      label: "status:dashboard:latest",
      query: "status:query:incident:latest",
      columns: [{ field: "name", label: "status:dashboard:col-name" }],
    },
  ],
};

const schema: FeatureSchema = {
  featureName: "status",
  entities: {},
  screens: [dashboardScreen],
};

function makeDispatcher(): Dispatcher {
  return createMockDispatcher({
    query: (async (type: string) => {
      if (type === "status:query:monitor:uptime-stat") {
        return {
          isSuccess: true,
          data: { value: "99,98 %", sub: "letzte 90 Tage", tone: "positive" },
        };
      }
      return {
        isSuccess: true,
        data: { rows: [{ id: "i1", name: "API-Ausfall" }], nextCursor: null },
      };
    }) as unknown as Dispatcher["query"],
  });
}

describe("KumikoScreen dashboard", () => {
  test("without a registered body → Placeholder banner", () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <KumikoScreen schema={schema} qn="status:screen:overview" />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("kumiko-screen-dashboard-placeholder")).toBeTruthy();
  });

  test("WebDashboardBody renders Stat and List panels from the queries", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={schema} qn="status:screen:overview" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByText("99,98 %")).toBeTruthy());
    expect(screen.getByTestId("dashboard-overview")).toBeTruthy();
    expect(screen.getByText("status:dashboard:uptime")).toBeTruthy();
    expect(screen.getByText("letzte 90 Tage")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("API-Ausfall")).toBeTruthy());
  });

  test("showUpdatedAt=false hides the updated-at stamp; default shows it", async () => {
    const quiet: FeatureSchema = {
      featureName: "status",
      entities: {},
      screens: [{ ...dashboardScreen, showUpdatedAt: false }],
    };
    const view = (s: FeatureSchema) => (
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={s} qn="status:screen:overview" />
        </DashboardBodyProvider>
      </DispatcherProvider>
    );
    const first = render(view(quiet));
    await waitFor(() => expect(screen.getByText("99,98 %")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-overview-updated-at")).toBeNull();
    first.unmount();
    render(view(schema));
    await waitFor(() => expect(screen.getByText("99,98 %")).toBeTruthy());
    expect(screen.getByTestId("dashboard-overview-updated-at")).toBeTruthy();
  });
});

// screen.description exists on DashboardScreenDefinition (types/src/
// screen.ts:713) but WebDashboardBody never read it — the panels grid
// rendered with no room for it at all.
describe("KumikoScreen dashboard — screen.description", () => {
  test("a plain-text description is agent-facing and does not render", async () => {
    const screenWithDescription: DashboardScreenDefinition = {
      ...dashboardScreen,
      description: "Live health signals across every monitored service.",
    };
    const schemaWithDescription: FeatureSchema = {
      featureName: "status",
      entities: {},
      screens: [screenWithDescription],
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={schemaWithDescription} qn="status:screen:overview" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("dashboard-overview")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-overview-description")).toBeNull();
    expect(screen.queryByText("Live health signals across every monitored service.")).toBeNull();
  });

  test("a description that is a known i18n key renders translated, not as the raw key", async () => {
    const screenWithDescription: DashboardScreenDefinition = {
      ...dashboardScreen,
      description: "status:dashboard:explainer",
    };
    const schemaWithDescription: FeatureSchema = {
      featureName: "status",
      entities: {},
      screens: [screenWithDescription],
    };
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen
            schema={schemaWithDescription}
            qn="status:screen:overview"
            translate={(key) =>
              key === "status:dashboard:explainer" ? "Refreshes every 60 seconds." : key
            }
          />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );

    const description = screen.getByTestId("dashboard-overview-description");
    expect(description.textContent).toBe("Refreshes every 60 seconds.");
    expect(description.textContent).not.toBe("status:dashboard:explainer");
  });

  test("a screen without description renders no description block", async () => {
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={schema} qn="status:screen:overview" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("dashboard-overview")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-overview-description")).toBeNull();
  });
});

const richScreen: DashboardScreenDefinition = {
  id: "rich",
  type: "dashboard",
  filter: {
    id: "region",
    label: "widgets:dashboard:filter-region",
    kind: "select",
    options: [
      { value: "eu", label: "widgets:dashboard:filter-region-eu" },
      { value: "us", label: "widgets:dashboard:filter-region-us" },
    ],
  },
  panels: [
    {
      kind: "stat",
      id: "kpi",
      label: "widgets:dashboard:kpi",
      query: "widgets:query:metrics:kpi",
      valueField: "value",
      deltaField: "delta",
      deltaDirectionField: "deltaDirection",
      deltaToneField: "deltaTone",
      icon: { react: { __component: "rich-dashboard-kpi-icon" } },
      accentColor: "#123456",
    },
    {
      kind: "stat-group",
      id: "net-worth",
      label: "widgets:dashboard:net-worth",
      stats: [
        {
          kind: "stat",
          id: "assets",
          label: "widgets:dashboard:assets",
          query: "widgets:query:metrics:assets",
          valueField: "value",
        },
      ],
    },
    {
      kind: "feed",
      id: "upcoming",
      label: "widgets:dashboard:upcoming",
      query: "widgets:query:metrics:upcoming",
    },
    {
      kind: "progress-list",
      id: "goal-progress",
      label: "widgets:dashboard:goal-progress",
      query: "widgets:query:metrics:goal-progress",
    },
    {
      kind: "custom",
      id: "custom-panel",
      component: { react: { __component: "rich-dashboard-custom" } },
    },
  ],
};

const richSchema: FeatureSchema = {
  featureName: "widgets",
  entities: {},
  screens: [richScreen],
};

function BrowserNav({ children }: { readonly children: ReactNode }): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

function RegionEcho({ filterParams }: ExtensionSectionProps): ReactNode {
  return <div data-testid="custom-echo">{String(filterParams?.["region"] ?? "none")}</div>;
}

function CustomEcho({ screenId, filterParams }: ExtensionSectionProps): ReactNode {
  return (
    <div data-testid="custom-echo">
      {screenId}:{String(filterParams?.["region"] ?? "none")}
    </div>
  );
}

function KpiIcon(): ReactNode {
  return <svg data-testid="kpi-icon" />;
}

describe("KumikoScreen dashboard — neue Panel-Kinds", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("stat-group rendert Sektions-Titel + genestete Stat-Panels", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:assets") {
          return { isSuccess: true, data: { value: "120.000 €" } };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    expect(screen.getByText("widgets:dashboard:net-worth")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("120.000 €")).toBeTruthy());
  });

  test("feed-Panel rendert primary/trailing-Zeilen", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:upcoming") {
          return {
            isSuccess: true,
            data: { rows: [{ primary: "Zinsanpassung", trailing: "Aug 2026" }] },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("Zinsanpassung")).toBeTruthy());
    expect(screen.getByText("Aug 2026")).toBeTruthy();
  });

  test("progress-list-Panel rendert Label/Wert + Fortschrittsbalken", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:goal-progress") {
          return {
            isSuccess: true,
            data: { rows: [{ label: "Baudarlehen", value: "42.000 € offen", fraction: 0.71 }] },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("Baudarlehen")).toBeTruthy());
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("71");
  });

  test("custom panel: registered component renders with screenId + filterParams", async () => {
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={{ "rich-dashboard-custom": CustomEcho }}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
          </DashboardBodyProvider>
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("custom-echo")).toBeTruthy());
    expect(screen.getByTestId("custom-echo").textContent).toBe("rich:none");
  });

  test("custom panel: static params reach the component and win over a screen filter value", async () => {
    window.history.replaceState(null, "", "/rich?region=us");
    const schema: FeatureSchema = {
      ...richSchema,
      screens: [
        {
          ...richScreen,
          panels: [
            {
              kind: "custom",
              id: "custom-panel",
              component: { react: { __component: "rich-dashboard-custom" } },
              params: { region: "eu" },
            },
          ],
        },
      ],
    };
    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={createMockDispatcher()}>
          <ExtensionSectionsProvider value={{ "rich-dashboard-custom": RegionEcho }}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="widgets:screen:rich" />
            </DashboardBodyProvider>
          </ExtensionSectionsProvider>
        </DispatcherProvider>
      </BrowserNav>,
    );
    await waitFor(() => expect(screen.getByTestId("custom-echo")).toBeTruthy());
    expect(screen.getByTestId("custom-echo").textContent).toBe("eu");
  });

  test("custom panel: unregistered component renders nothing, does not throw", async () => {
    const dispatcher = createMockDispatcher();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-kpi")).toBeTruthy());
    expect(screen.queryByTestId("custom-echo")).toBeNull();
  });

  test("stat panel: Delta chip renders only when value+direction are provided", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:kpi") {
          return {
            isSuccess: true,
            data: {
              value: "92.753 €",
              delta: "23 %",
              deltaDirection: "down",
              deltaTone: "positive",
            },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("92.753 €")).toBeTruthy());
    expect(screen.getByText("↓23 %")).toBeTruthy();
  });

  test("stat panel: registered icon renders, unregistered icon renders nothing (no crash)", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:kpi") {
          return { isSuccess: true, data: { value: "92.753 €" } };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <ExtensionSectionsProvider value={{ "rich-dashboard-kpi-icon": KpiIcon }}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
          </DashboardBodyProvider>
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("kpi-icon")).toBeTruthy());
  });

  test("stat panel: unregistered icon renders nothing, does not throw", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:kpi") {
          return { isSuccess: true, data: { value: "92.753 €" } };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("92.753 €")).toBeTruthy());
    expect(screen.queryByTestId("kpi-icon")).toBeNull();
    // An unregistered icon must not render an empty, accent-colored
    // chip wrapper either (StatCard gates the span on icon !== undefined).
    const card = screen.getByTestId("dashboard-panel-kpi");
    expect(card.querySelector('[style*="123456"]')).toBeNull();
  });

  test("stat panel: missing deltaDirection suppresses the chip (no crash)", async () => {
    const dispatcher = createMockDispatcher({
      query: (async (type: string) => {
        if (type === "widgets:query:metrics:kpi") {
          return { isSuccess: true, data: { value: "92.753 €" } };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <DashboardBodyProvider value={WebDashboardBody}>
          <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
        </DashboardBodyProvider>
      </DispatcherProvider>,
    );
    await waitFor(() => expect(screen.getByText("92.753 €")).toBeTruthy());
    expect(screen.queryByText("23 %")).toBeNull();
  });

  test("Filter change refetches Stat AND Feed panels with a new payload", async () => {
    window.history.replaceState(null, "", "/rich");

    const calls: { readonly type: string; readonly payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) => {
        calls.push({ type, payload });
        const region = (payload as { readonly region?: string } | undefined)?.region;
        if (type === "widgets:query:metrics:kpi") {
          return { isSuccess: true, data: { value: region === "us" ? "38.120 $" : "92.753 €" } };
        }
        if (type === "widgets:query:metrics:upcoming") {
          return {
            isSuccess: true,
            data: {
              rows: [{ primary: region === "us" ? "US-Event" : "EU-Event" }],
            },
          };
        }
        return { isSuccess: true, data: {} };
      }) as unknown as Dispatcher["query"],
    });
    const user = userEvent.setup();
    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcher}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen schema={richSchema} qn="widgets:screen:rich" />
          </DashboardBodyProvider>
        </DispatcherProvider>
      </BrowserNav>,
    );
    await waitFor(() => expect(screen.getByText("92.753 €")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("EU-Event")).toBeTruthy());

    await user.click(screen.getByTestId("combobox-dashboard-filter-region"));
    const usOption = await screen.findByText("widgets:dashboard:filter-region-us");
    await user.click(usOption);

    await waitFor(() => expect(screen.getByText("38.120 $")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("US-Event")).toBeTruthy());
  });

  test("Filter value prefilled from URL search param: Deep link ?tenantId=t-2 lands in the panel query", async () => {
    window.history.replaceState(null, "", "/rich?tenantId=t-2");

    const calls: { readonly type: string; readonly payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) => {
        calls.push({ type, payload });
        return { isSuccess: true, data: { value: "92.753 €" } };
      }) as unknown as Dispatcher["query"],
    });

    const deepLinkScreen: DashboardScreenDefinition = {
      id: "rich",
      type: "dashboard",
      filter: {
        id: "tenantId",
        label: "widgets:dashboard:filter-tenant",
        kind: "select",
        options: [{ value: "t-2", label: "widgets:dashboard:filter-tenant-t2" }],
      },
      panels: [
        {
          kind: "stat",
          id: "kpi",
          label: "widgets:dashboard:kpi",
          query: "widgets:query:metrics:kpi",
          valueField: "value",
        },
      ],
    };
    const deepLinkSchema: FeatureSchema = {
      featureName: "widgets",
      entities: {},
      screens: [deepLinkScreen],
    };

    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcher}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen schema={deepLinkSchema} qn="widgets:screen:rich" />
          </DashboardBodyProvider>
        </DispatcherProvider>
      </BrowserNav>,
    );

    await waitFor(() => expect(screen.getByText("92.753 €")).toBeTruthy());
    const kpiCall = calls.find((c) => c.type === "widgets:query:metrics:kpi");
    expect(kpiCall?.payload).toEqual({ tenantId: "t-2" });
  });

  test("a stat with navigate links to the target list and ignores the dashboard filter in its payload", async () => {
    window.history.replaceState(null, "", "/overview?tenantId=t-2");
    const calls: { readonly type: string; readonly payload: unknown }[] = [];
    const dispatcher = createMockDispatcher({
      query: (async (type: string, payload: unknown) => {
        calls.push({ type, payload });
        return {
          isSuccess: true,
          data: { rows: [], nextCursor: null, total: 4 },
        };
      }) as unknown as Dispatcher["query"],
    });
    const navSchema: FeatureSchema = {
      featureName: "work",
      entities: {},
      screens: [
        {
          id: "overview",
          type: "dashboard",
          filter: {
            id: "tenantId",
            label: "work:dashboard:filter-tenant",
            kind: "select",
            options: [{ value: "t-2", label: "work:dashboard:filter-tenant-t2" }],
          },
          panels: [
            {
              kind: "stat",
              id: "overdue",
              label: "work:dashboard:overdue",
              query: "work:query:task:list",
              valueField: "total",
              params: { namedFilter: "overdue", limit: 1, totalCount: true },
              navigate: { screen: "task-list", namedFilter: "overdue" },
            },
          ],
        },
      ],
    };

    render(
      <BrowserNav>
        <DispatcherProvider dispatcher={dispatcher}>
          <DashboardBodyProvider value={WebDashboardBody}>
            <KumikoScreen schema={navSchema} qn="work:screen:overview" />
          </DashboardBodyProvider>
        </DispatcherProvider>
      </BrowserNav>,
    );

    const link = await screen.findByTestId("dashboard-panel-overdue-link");
    expect(calls.find((c) => c.type === "work:query:task:list")?.payload).toEqual({
      namedFilter: "overdue",
      limit: 1,
      totalCount: true,
    });
    expect(screen.getByText("4")).toBeTruthy();
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("task-list");
    expect(decodeURIComponent(href)).toContain("task-list.filter=overdue");

    await userEvent.click(link);
    expect(window.location.pathname).toContain("task-list");
    expect(window.location.search).toContain("task-list.filter=overdue");
  });
});

const sessionsSchema: FeatureSchema = {
  featureName: "sessions",
  entities: {},
  screens: [
    {
      id: "my-sessions",
      type: "projectionList",
      query: "sessions:query:user-session:mine",
      columns: [{ field: "userAgent", label: "sessions.mine.col.userAgent" }],
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    },
    {
      id: "session-list",
      type: "projectionList",
      query: "sessions:query:user-session:list",
      columns: [{ field: "userAgent", label: "sessions.list.col.userAgent" }],
      access: { roles: ["SystemAdmin"] },
    },
  ],
};

const mfaSchema: FeatureSchema = {
  featureName: "auth-mfa",
  entities: {},
  screens: [
    {
      id: "auth-mfa-enable",
      type: "secretMint",
      handler: "auth-mfa:write:enable-start",
      fields: {},
      layout: { sections: [] },
      submitLabel: "mfa.enable.start",
      reveal: { fields: [{ field: "recoveryCodes", label: "codes", display: "list" }] },
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    },
    {
      id: "auth-mfa-disable",
      type: "actionForm",
      handler: "auth-mfa:write:disable",
      fields: { code: { type: "text", required: true } },
      layout: { sections: [{ fields: ["code"] }] },
      submitLabel: "mfa.disable.submit",
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    },
  ],
};

const mfaStatus = { query: "auth-mfa:query:user-mfa:status", field: "enabled" } as const;

// fillHeight lists carry no screen padding at all, so the padding assertions
// need a list that opts out of it.
const paddedSessionsSchema: FeatureSchema = {
  ...sessionsSchema,
  screens: sessionsSchema.screens.map((screenDef) =>
    screenDef.type === "projectionList" ? { ...screenDef, fillHeight: false } : screenDef,
  ),
};

const accountSecuritySchema: FeatureSchema = {
  featureName: "account-security",
  entities: {},
  screens: [
    {
      id: "account-security",
      type: "dashboard",
      panels: [
        {
          kind: "screen",
          id: "mfa-enable",
          screen: "auth-mfa:screen:auth-mfa-enable",
          visibleWhen: { ...mfaStatus, eq: false },
        },
        {
          kind: "screen",
          id: "mfa-disable",
          screen: "auth-mfa:screen:auth-mfa-disable",
          visibleWhen: { ...mfaStatus, eq: true },
        },
        {
          kind: "screen",
          id: "sessions",
          screen: "sessions:screen:my-sessions",
          label: "account-security:panel:sessions",
        },
        { kind: "screen", id: "admin-sessions", screen: "sessions:screen:session-list" },
      ],
    },
  ],
};

function renderAccountSecurity(
  mfaEnabled: boolean,
  schema: FeatureSchema = accountSecuritySchema,
  sessions: FeatureSchema = sessionsSchema,
  options: { readonly statusFails?: boolean; readonly statusGate?: Promise<void> } = {},
): { readonly queryTypes: string[] } {
  const queryTypes: string[] = [];
  const dispatcher = createMockDispatcher({
    query: (async (type: string) => {
      queryTypes.push(type);
      if (type === mfaStatus.query) {
        await options.statusGate;
        if (options.statusFails === true) {
          return {
            isSuccess: false,
            error: { code: "internal", message: "kaputt", i18nKey: "errors.internal" },
          };
        }
        return { isSuccess: true, data: { enabled: mfaEnabled } };
      }
      if (type === "sessions:query:user-session:mine") {
        return {
          isSuccess: true,
          data: { rows: [{ id: "s1", userAgent: "Firefox on Linux" }], nextCursor: null },
        };
      }
      return {
        isSuccess: true,
        data: { rows: [{ id: "x", userAgent: "ADMIN ROW" }], nextCursor: null },
      };
    }) as unknown as Dispatcher["query"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <AppFeaturesProvider features={[schema, sessions, mfaSchema]}>
        <UserRolesProvider roles={["User"]}>
          <BrowserNav>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn="account-security:screen:account-security" />
            </DashboardBodyProvider>
          </BrowserNav>
        </UserRolesProvider>
      </AppFeaturesProvider>
    </DispatcherProvider>,
  );
  return { queryTypes };
}

describe("KumikoScreen dashboard — screen panels", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  test("embeds a Cross-Feature-projectionList screen together with its label", async () => {
    renderAccountSecurity(false);
    await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
    expect(screen.getByTestId("dashboard-panel-sessions")).toBeTruthy();
    expect(screen.getByText("account-security:panel:sessions")).toBeTruthy();
  });

  test("visibleWhen shows only the panel matching the query value", async () => {
    renderAccountSecurity(false);
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-mfa-enable")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-panel-mfa-disable")).toBeNull();
  });

  test("visibleWhen with reversed status shows the other panel", async () => {
    renderAccountSecurity(true);
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-mfa-disable")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-panel-mfa-enable")).toBeNull();
  });

  test("two panels with the same visibleWhen query trigger the query only once", async () => {
    const { queryTypes } = renderAccountSecurity(false);
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-mfa-enable")).toBeTruthy());
    expect(queryTypes.filter((type) => type === mfaStatus.query)).toHaveLength(1);
  });

  test("if the visibleWhen query fails, the panel shows an error instead of disappearing", async () => {
    renderAccountSecurity(false, accountSecuritySchema, sessionsSchema, { statusFails: true });
    await waitFor(() => expect(screen.getByTestId("dashboard-panel-mfa-enable")).toBeTruthy());
    expect(
      within(screen.getByTestId("dashboard-panel-mfa-enable")).getByRole("alert"),
    ).toBeTruthy();
    expect(screen.getByTestId("dashboard-panel-mfa-disable")).toBeTruthy();
  });

  describe("fallback", () => {
    const fallbackSchema: FeatureSchema = {
      ...accountSecuritySchema,
      screens: [
        {
          id: "account-security",
          type: "dashboard",
          panels: [
            {
              kind: "screen",
              id: "mfa",
              screen: "auth-mfa:screen:auth-mfa-disable",
              visibleWhen: { ...mfaStatus, eq: true },
              fallback: "sessions:screen:my-sessions",
            },
          ],
        },
      ],
    };

    test("shows the fallback screen in the panel's place while visibleWhen is unmet", async () => {
      renderAccountSecurity(false, fallbackSchema);
      await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
      expect(
        within(screen.getByTestId("dashboard-panel-mfa")).getByText("Firefox on Linux"),
      ).toBeTruthy();
      expect(screen.queryByText("mfa.disable.submit")).toBeNull();
    });

    test("shows the panel itself once visibleWhen is met", async () => {
      renderAccountSecurity(true, fallbackSchema);
      await waitFor(() => expect(screen.getByText("mfa.disable.submit")).toBeTruthy());
      expect(screen.queryByText("Firefox on Linux")).toBeNull();
    });

    test("shows nothing while the gate query is loading", () => {
      renderAccountSecurity(false, fallbackSchema);
      expect(screen.queryByTestId("dashboard-panel-mfa")).toBeNull();
      expect(screen.queryByText("Firefox on Linux")).toBeNull();
    });

    test("never mounts the fallback screen before the gate answers", async () => {
      let openGate: () => void = () => {};
      const statusGate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const { queryTypes } = renderAccountSecurity(false, fallbackSchema, sessionsSchema, {
        statusGate,
      });
      await act(async () => {});
      expect(queryTypes).toContain(mfaStatus.query);
      expect(queryTypes).not.toContain("sessions:query:user-session:mine");

      openGate();
      await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
    });

    test("falls back when the gate query fails instead of showing an error", async () => {
      renderAccountSecurity(true, fallbackSchema, sessionsSchema, { statusFails: true });
      await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
      expect(screen.queryByRole("alert")).toBeNull();
    });

    test("chromeless applies to the fallback as well", async () => {
      const chromeless: FeatureSchema = {
        ...fallbackSchema,
        screens: fallbackSchema.screens.map((screenDef) =>
          screenDef.type === "dashboard"
            ? {
                ...screenDef,
                panels: screenDef.panels.map((panel) =>
                  panel.kind === "screen" ? { ...panel, chromeless: true } : panel,
                ),
              }
            : screenDef,
        ),
      };
      renderAccountSecurity(false, chromeless, paddedSessionsSchema);
      await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
      expect(
        screen.getByTestId("dashboard-panel-mfa").querySelector("[data-slot=card]"),
      ).toBeNull();
    });
  });

  test("without access to the target screen, the tile disappears completely (no access banner)", async () => {
    renderAccountSecurity(false);
    await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
    expect(screen.queryByTestId("dashboard-panel-admin-sessions")).toBeNull();
    expect(screen.queryByText("ADMIN ROW")).toBeNull();
    expect(screen.queryByTestId("kumiko-screen-access-denied")).toBeNull();
  });

  test("chromeless list panel drops the card and the list's own screen padding", async () => {
    const chromelessSchema: FeatureSchema = {
      ...accountSecuritySchema,
      screens: accountSecuritySchema.screens.map((screenDef) =>
        screenDef.type === "dashboard"
          ? {
              ...screenDef,
              panels: screenDef.panels.map((panel) =>
                panel.kind === "screen" && panel.id === "sessions"
                  ? { ...panel, chromeless: true }
                  : panel,
              ),
            }
          : screenDef,
      ),
    };
    renderAccountSecurity(false, chromelessSchema, paddedSessionsSchema);
    await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
    const panel = screen.getByTestId("dashboard-panel-sessions");
    expect(panel.querySelector("[data-slot=card]")).toBeNull();
    expect(panel.querySelector(".px-4")).toBeNull();
    expect(screen.getByText("account-security:panel:sessions")).toBeTruthy();
  });

  test("list panel without the option keeps card and screen padding", async () => {
    renderAccountSecurity(false, accountSecuritySchema, paddedSessionsSchema);
    await waitFor(() => expect(screen.getByText("Firefox on Linux")).toBeTruthy());
    const panel = screen.getByTestId("dashboard-panel-sessions");
    expect(panel.querySelector("[data-slot=card]")).not.toBeNull();
    expect(panel.querySelector(".px-4")).not.toBeNull();
  });
});
