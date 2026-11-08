// projectionDetail board options: initialTab, afterForm slot, phone footer actions with a hint, steps label and visibleWhen.
import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { ReactNode } from "react";
import type { Dispatcher } from "../../headless/index.ts";
import type { ExtensionSectionProps, FeatureSchema, NavApi } from "../../index.ts";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
  NavProvider,
} from "../../index.ts";
import {
  createMockDispatcher,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  waitFor,
} from "./test-utils.tsx";

const writeAction = (id: string) => ({
  kind: "writeHandler" as const,
  id,
  label: `Do ${id}`,
  handler: `shop:write:${id}`,
});

const record = {
  id: "o1",
  name: "Order 1",
  state: "open",
  steps: [{ id: "s1", title: "Step one" }],
};

const base: ProjectionDetailScreenDefinition = {
  id: "order-detail",
  type: "projectionDetail",
  query: "shop:query:order:detail",
  layout: {
    mode: "tabs",
    sections: [
      { id: "overview", title: "Overview", fields: ["name"] },
      { id: "history", title: "History", fields: ["state"] },
    ],
  },
};

function AfterForm({ activeTabId }: ExtensionSectionProps): ReactNode {
  return <div data-testid="after-form">{`tab:${activeTabId}`}</div>;
}

function renderDetail(
  definition: ProjectionDetailScreenDefinition,
  searchParams: Record<string, string> = {},
  data: Record<string, unknown> = record,
): void {
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  const nav: NavApi = {
    route: undefined,
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams,
    setSearchParams: () => {},
  };
  const schema: FeatureSchema = { featureName: "shop", entities: {}, screens: [definition] };
  render(
    <NavProvider value={nav}>
      <ExtensionSectionsProvider value={{ "after-form": AfterForm }}>
        <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
          <KumikoScreen schema={schema} qn="shop:screen:order-detail" entityId="o1" />
        </DispatcherProvider>
      </ExtensionSectionsProvider>
    </NavProvider>,
  );
}

describe("projectionDetail initialTab", () => {
  const withRules = (rules: ProjectionDetailScreenDefinition["initialTab"]) => ({
    ...base,
    initialTab: rules,
  });

  test("the first matching rule opens its tab", async () => {
    renderDetail(
      withRules([
        { when: { field: "state", eq: "done" }, tab: "overview" },
        { when: { field: "state", eq: "open" }, tab: "history" },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
  });

  test("no matching rule opens the first tab", async () => {
    renderDetail(withRules([{ when: { field: "state", eq: "done" }, tab: "history" }]));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
  });

  test("an explicit ?tab wins over the rules", async () => {
    renderDetail(withRules([{ when: { field: "state", eq: "open" }, tab: "history" }]), {
      tab: "overview",
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
  });
});

describe("projectionDetail slots.afterForm", () => {
  test("renders under the sections and receives the active tab id", async () => {
    renderDetail(
      { ...base, slots: { afterForm: { react: { __component: "after-form" } } } },
      { tab: "history" },
    );
    expect((await screen.findByTestId("after-form")).textContent).toBe("tab:history");
  });
});

describe("projectionDetail footerActions on a phone", () => {
  restoreViewportWidthAfterEach();
  const definition: ProjectionDetailScreenDefinition = {
    ...base,
    layout: { sections: [{ title: "Order", fields: ["name"] }] },
    actions: [writeAction("approve"), writeAction("decline")],
    footerActions: ["approve", "decline"],
    footerHint: "shop.footer.hint",
  };

  test("both actions stay in the footer instead of a more-menu", async () => {
    setViewportWidth(500);
    renderDetail(definition);
    await waitFor(() => expect(screen.getByTestId("render-edit-action-approve")).toBeTruthy());
    expect(screen.getByTestId("render-edit-action-decline")).toBeTruthy();
  });

  test("the hint stands in the footer on a wide screen", async () => {
    setViewportWidth(1280);
    renderDetail(definition);
    expect((await screen.findByTestId("render-edit-footer-hint")).textContent).toContain(
      "shop.footer.hint",
    );
  });
});

describe("projectionDetail steps options", () => {
  const stepsScreen = (extra: Record<string, unknown>): ProjectionDetailScreenDefinition => ({
    ...base,
    layout: { sections: [{ title: "Order", fields: ["name"] }] },
    steps: {
      field: "steps",
      moreActionsLabel: "shop.steps.clarify",
      actions: [writeAction("main"), writeAction("other")],
      ...extra,
    },
  });

  test("the label stands before the further actions", async () => {
    renderDetail(stepsScreen({}));
    const label = await screen.findByTestId("record-step-s1-more-actions-label");
    expect(label.textContent).toContain("shop.steps.clarify");
  });

  test("visibleWhen hides the whole panel while the condition fails", async () => {
    renderDetail(stepsScreen({ visibleWhen: { field: "state", eq: "done" } }));
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    expect(screen.queryByTestId("kumiko-screen-projection-detail-steps")).toBeNull();
  });

  test("visibleWhen keeps the panel while the condition holds", async () => {
    renderDetail(stepsScreen({ visibleWhen: { field: "state", eq: "open" } }));
    expect(await screen.findByTestId("kumiko-screen-projection-detail-steps")).toBeTruthy();
  });
});
