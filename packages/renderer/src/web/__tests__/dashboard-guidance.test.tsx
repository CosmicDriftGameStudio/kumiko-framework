// Dashboard additions for "what to do next" screens: row tone and hint cells in list
// panels, parametrized screen links, query-fed text panels and stat navigate params.
import { describe, expect, test } from "bun:test";
import type {
  DashboardScreenDefinition,
  DashboardTextPanel,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { QueryResult } from "../../headless/index.ts";
import { isRecord } from "../../headless/is-record.ts";
import type { FeatureSchema } from "../../index.ts";
import {
  AppFeaturesProvider,
  createStaticLocaleResolver,
  DashboardBodyProvider,
  DispatcherProvider,
  KumikoScreen,
  kumikoDefaultTranslations,
  LocaleProvider,
  NavProvider,
} from "../../index.ts";
import { WebDashboardBody } from "../app/dashboard-body.tsx";
import { useBrowserNavApi } from "../app/nav.tsx";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

type Handler = (payload: Readonly<Record<string, unknown>>) => QueryResult | Promise<QueryResult>;

function BrowserNav({
  children,
  features,
}: {
  readonly children: ReactNode;
  readonly features: readonly FeatureSchema[];
}): ReactNode {
  const nav = useBrowserNavApi({ hasWorkspaces: false, features });
  return <NavProvider value={nav}>{children}</NavProvider>;
}

const TRANSLATIONS = {
  "de-DE": {
    "demo:greeting": "Hallo {name}",
    "demo:static-heading": "Statische Hilfe",
    "demo:list-label": "Aufgaben",
  },
};

function renderDashboard(
  dashboard: DashboardScreenDefinition,
  handlers: Readonly<Record<string, Handler>>,
  appFeatures: readonly FeatureSchema[] = [],
): void {
  const dispatcher = createMockDispatcher({
    query: async (type: string, payload: unknown) => {
      const handler = handlers[type];
      return handler === undefined
        ? { isSuccess: true, data: {} }
        : await handler(isRecord(payload) ? payload : {});
    },
  });
  const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [dashboard] };
  render(
    <LocaleProvider
      resolver={createStaticLocaleResolver({ locale: "de-DE" })}
      fallbackBundles={[kumikoDefaultTranslations, TRANSLATIONS]}
    >
      <AppFeaturesProvider features={appFeatures}>
        <BrowserNav features={appFeatures}>
          <DispatcherProvider dispatcher={dispatcher}>
            <DashboardBodyProvider value={WebDashboardBody}>
              <KumikoScreen schema={schema} qn={`demo:screen:${dashboard.id}`} />
            </DashboardBodyProvider>
          </DispatcherProvider>
        </BrowserNav>
      </AppFeaturesProvider>
    </LocaleProvider>,
  );
}

const ok = (data: unknown): QueryResult => ({ isSuccess: true, data });

const TASK_ROW = {
  id: "t1",
  title: "Send reminder",
  due: "until Friday",
  why: "The invoice is 14 days overdue.",
  tone: "warn",
  target: "demo:screen:task-form",
  targetParams: { entityId: "t1", prefill: "late", count: 3, returnTo: "row-chosen-back" },
};

function listDashboard(panelExtras: Record<string, unknown>): DashboardScreenDefinition {
  return {
    id: "tasks",
    type: "dashboard",
    panels: [
      {
        kind: "list",
        id: "open",
        label: "demo:list-label",
        query: "demo:query:task:list",
        columns: [{ field: "title" }],
        ...panelExtras,
      },
    ],
  } as DashboardScreenDefinition;
}

const taskRows = () => ok({ rows: [TASK_ROW, { ...TASK_ROW, id: "t2", title: "", tone: "bad" }] });

describe("dashboard list panel row guidance", () => {
  test("rowToneField draws the row tone stripe", async () => {
    renderDashboard(listDashboard({ rowToneField: "tone" }), { "demo:query:task:list": taskRows });
    const cell = await screen.findByText("Send reminder");
    expect(cell.closest("tr")?.className).toContain("--color-status-warn");
  });

  test("a hint column shows sentence and detail, the empty label for a blank sentence", async () => {
    renderDashboard(
      listDashboard({
        rowToneField: "tone",
        columns: [{ field: "title", hint: { detailField: "due" } }],
      }),
      { "demo:query:task:list": taskRows },
    );
    const sentence = await screen.findByText("Send reminder");
    expect(sentence.closest("[data-hint-tone]")?.getAttribute("data-hint-tone")).toBe("warn");
    screen.getByText("until Friday");
    screen.getByText("Nothing open");
  });

  test("the Why toggle reveals the reason without following the row", async () => {
    renderDashboard(
      listDashboard({ columns: [{ field: "title", hint: { reasonField: "why" } }] }),
      { "demo:query:task:list": taskRows },
    );
    const toggle = await screen.findByRole("button", { name: "Why?" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("The invoice is 14 days overdue.")).toBeNull();
    await userEvent.click(toggle);
    screen.getByText("The invoice is 14 days overdue.");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(toggle);
    expect(screen.queryByText("The invoice is 14 days overdue.")).toBeNull();
  });

  test("linkScreenField + linkParamsField open the record and carry the other keys as search params", async () => {
    const taskForm = {
      featureName: "demo",
      entities: {},
      screens: [{ id: "task-form", type: "entityEdit" }],
    } as unknown as FeatureSchema;
    renderDashboard(
      listDashboard({
        columns: [{ field: "title", linkScreenField: "target", linkParamsField: "targetParams" }],
      }),
      { "demo:query:task:list": taskRows },
      [taskForm],
    );
    const link = await screen.findByRole("link", { name: "Send reminder" });
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/task-form/t1");
    expect(href).toContain("prefill=late");
    expect(href).toContain("count=3");
    expect(href).not.toContain("entityId");
    expect(href).not.toContain("row-chosen-back");
  });
});

describe("dashboard text panel with a query", () => {
  type TextBlocks = NonNullable<DashboardTextPanel["blocks"]>;
  const staticBlocks: TextBlocks = [{ kind: "heading", text: "demo:static-heading" }];
  const textDashboard = (
    blocks: TextBlocks = staticBlocks,
    extras: { label?: string } = {},
  ): DashboardScreenDefinition => ({
    id: "help",
    type: "dashboard",
    panels: [{ kind: "text", id: "tips", query: "demo:query:tips", blocks, ...extras }],
  });

  test("static blocks show while the query loads, query blocks replace them afterwards", async () => {
    let release: (value: QueryResult) => void = () => {};
    const pending = new Promise<QueryResult>((resolve) => {
      release = resolve;
    });
    renderDashboard(textDashboard([{ kind: "heading", text: "demo:static-heading" }]), {
      "demo:query:tips": () => pending,
    });
    await screen.findByText("Statische Hilfe");
    release(ok({ blocks: [{ kind: "paragraph", text: "Live tip" }] }));
    await waitFor(() => screen.getByText("Live tip"));
    expect(screen.queryByText("Statische Hilfe")).toBeNull();
  });

  test("an empty answer keeps the static blocks", async () => {
    renderDashboard(textDashboard(), {
      "demo:query:tips": () => ok({ blocks: [] }),
    });
    await screen.findByText("Statische Hilfe");
  });

  test("DashboardI18nText is translated with its params", async () => {
    renderDashboard(textDashboard(), {
      "demo:query:tips": () =>
        ok({
          blocks: [
            {
              kind: "paragraph",
              text: { i18nKey: "demo:greeting", i18nParams: { name: "Ada" } },
            },
          ],
        }),
    });
    await screen.findByText("Hallo Ada");
  });

  test("an invalid block is dropped, the valid ones stay", async () => {
    renderDashboard(textDashboard(), {
      "demo:query:tips": () =>
        ok({
          blocks: [
            { kind: "paragraph", text: 42 },
            { kind: "mystery" },
            { kind: "hint", text: "Valid hint" },
          ],
        }),
    });
    await screen.findByText("Valid hint");
    expect(screen.queryByText("42")).toBeNull();
  });

  test("a non-array blocks answer counts as empty", async () => {
    renderDashboard(textDashboard(), {
      "demo:query:tips": () => ok({ blocks: "nope" }),
    });
    await screen.findByText("Statische Hilfe");
  });

  test("without static blocks a failing query shows the panel error", async () => {
    renderDashboard(textDashboard([], { label: "demo:list-label" }), {
      "demo:query:tips": () => ({
        isSuccess: false,
        error: {
          code: "internal",
          httpStatus: 500,
          message: "kaputt",
          i18nKey: "errors.internal",
        },
      }),
    });
    await screen.findByText(/konnte nicht geladen werden|could not be loaded/);
  });

  test("a link block to a screen the user may not open is hidden", async () => {
    const guarded = {
      featureName: "demo",
      entities: {},
      screens: [{ id: "secret", type: "custom", access: { roles: ["Admin"] } }],
    } as unknown as FeatureSchema;
    renderDashboard(
      textDashboard(),
      {
        "demo:query:tips": () =>
          ok({ blocks: [{ kind: "link", text: "Open secret", screen: "secret" }] }),
      },
      [guarded],
    );
    await waitFor(() => expect(screen.queryByText("Statische Hilfe")).toBeNull());
    expect(screen.queryByText("Open secret")).toBeNull();
  });
});

describe("dashboard stat navigate params", () => {
  test("navigate.params join the namedFilter param in the tile link", async () => {
    const taskList = {
      featureName: "demo",
      entities: {},
      screens: [{ id: "task-list", type: "projectionList", query: "demo:query:task:list" }],
    } as unknown as FeatureSchema;
    renderDashboard(
      {
        id: "stats",
        type: "dashboard",
        panels: [
          {
            kind: "stat",
            id: "failed",
            label: "demo:list-label",
            query: "demo:query:task:list",
            valueField: "total",
            navigate: {
              screen: "task-list",
              namedFilter: "failed",
              params: { tab: "retry", "task-list.filter": "ignored" },
            },
          },
        ],
      } as DashboardScreenDefinition,
      { "demo:query:task:list": () => ok({ total: 4 }) },
      [taskList],
    );
    const link = await screen.findByTestId("dashboard-panel-failed-link");
    const href = decodeURIComponent(link.getAttribute("href") ?? "");
    expect(href).toContain("tab=retry");
    expect(href).toContain("task-list.filter=failed");
    expect(href).not.toContain("ignored");
  });
});
