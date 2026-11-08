// One tab stacks a fields section, a relatedList and a stepList; a section with `visibleWhen`
// drops its tab while the record does not match.

import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema, NavApi } from "../../index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const detail: ProjectionDetailScreenDefinition = {
  id: "request-detail",
  type: "projectionDetail",
  query: "swap:query:request:detail",
  layout: {
    mode: "tabs",
    sections: [
      { id: "overview", title: "Overview", fields: ["wish"] },
      {
        id: "overview",
        kind: "relatedList",
        title: "Your stock",
        query: "swap:query:request:stock",
        columns: [{ field: "name", label: "Name" }],
        readOnly: true,
      },
      { id: "overview", kind: "stepList", title: "How a swap works", field: "steps" },
      {
        id: "chat",
        title: "Chat",
        fields: ["wish"],
        visibleWhen: { field: "state", ne: "ended" },
      },
      { id: "history", title: "History", fields: ["wish"] },
    ],
  },
};

const schema: FeatureSchema = { featureName: "swap", entities: {}, screens: [detail] };

function renderRequest(state: string, tab?: string): void {
  const query = (async (type: string) =>
    type === "swap:query:request:detail"
      ? {
          isSuccess: true,
          data: {
            id: "r1",
            wish: "A red chair",
            state,
            steps: [
              {
                title: "Offer sent",
                status: "Done",
                statusTone: "ok",
                description: "Seller knows",
              },
              { title: "Meet up" },
              { description: "dropped: no title" },
            ],
          },
        }
      : {
          isSuccess: true,
          data: { rows: [{ id: "s1", name: "Oak table" }], nextCursor: null },
        }) as unknown as Dispatcher["query"];
  const navApi: NavApi = {
    route: undefined,
    navigate: () => {},
    replace: () => {},
    hrefFor: () => "",
    searchParams: tab === undefined ? {} : { tab },
    setSearchParams: () => {},
  };
  render(
    <NavProvider value={navApi}>
      <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
        <KumikoScreen schema={schema} qn="swap:screen:request-detail" entityId="r1" />
      </DispatcherProvider>
    </NavProvider>,
  );
}

describe("projectionDetail composite tab", () => {
  test("the first tab shows fields, related list and numbered steps together", async () => {
    renderRequest("open");
    await waitFor(() => screen.getByText("A red chair"));
    expect(await screen.findByText("Oak table")).toBeDefined();
    expect(screen.getByText("Your stock")).toBeDefined();
    expect(screen.getByText("How a swap works")).toBeDefined();
    expect(screen.getByText("Offer sent")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
    expect(screen.getByText("Seller knows")).toBeDefined();
    expect(screen.getByText("Meet up")).toBeDefined();
    expect(screen.queryByText("dropped: no title")).toBeNull();
    expect(screen.getByTestId("step-list-step-0").textContent).toContain("1");
    expect(screen.getByTestId("step-list-step-1").textContent).toContain("2");
  });

  test("the blocks of one tab share a single tab button", async () => {
    renderRequest("open");
    await waitFor(() => screen.getByText("A red chair"));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Chat",
      "History",
    ]);
  });

  test("a tab whose visibleWhen does not match is gone from the strip", async () => {
    renderRequest("ended");
    await waitFor(() => screen.getByText("A red chair"));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "History",
    ]);
  });

  test("a ?tab= value pointing at a hidden tab falls back to the first visible one", async () => {
    renderRequest("ended", "chat");
    expect(await screen.findByText("How a swap works")).toBeDefined();
  });
});
