// Phone layout of two real-world projectionDetail declarations: header block order and pinned footer.
import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import {
  createMockDispatcher,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  waitFor,
} from "./test-utils.tsx";

function renderScreen(definition: ProjectionDetailScreenDefinition, data: unknown): void {
  const query = (async () => ({ isSuccess: true, data })) as unknown as Dispatcher["query"];
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "shop", entities: {}, screens: [definition] }}
        qn={`shop:screen:${definition.id}`}
        entityId="r1"
      />
    </DispatcherProvider>,
  );
}

const live = { field: "status", ne: "ended" } as const;

const requestFile: ProjectionDetailScreenDefinition = {
  id: "file",
  type: "projectionDetail",
  query: "shop:query:file",
  valueDisplay: "text",
  header: { title: "title", subtitle: "subtitle", status: "status" },
  summary: { field: "summary", icon: "sparkles" },
  metrics: [
    { field: "receivedAt", label: "Received" },
    { field: "windowLabel", label: "Window" },
    { field: "photoCountLabel", label: "Photos", hideOnNarrow: true },
  ],
  metricsPlacement: { narrow: "after-guidance" },
  banner: { field: "notice" },
  steps: {
    field: "steps",
    title: "Next step",
    moreActionsLabel: "More",
    visibleWhen: live,
    actions: [
      { kind: "writeHandler", id: "review", label: "Review", handler: "shop:write:review" },
    ],
  },
  layout: {
    mode: "tabs",
    sections: [
      {
        id: "overview",
        kind: "fields",
        title: "Overview",
        visibleWhen: live,
        groups: [{ title: "Wanted", columns: 6, fields: ["make", "model"] }],
      },
      {
        id: "overview",
        kind: "relatedList",
        title: "Stock",
        visibleWhen: live,
        query: "shop:query:stock",
        parentParam: "requestId",
        columns: [{ field: "make", label: "Make" }],
      },
      { id: "overview", kind: "stepList", title: "Flow", field: "flowSteps", visibleWhen: live },
      { id: "history", kind: "fields", title: "History", fields: ["make"] },
    ],
  },
};

const fileRecord = {
  id: "r1",
  title: "Request",
  subtitle: "sub",
  status: "open",
  summary: "AI line",
  notice: { title: "Heads up", text: "Check" },
  receivedAt: "now",
  windowLabel: "3 days",
  photoCountLabel: "4",
  make: "VW",
  model: "Golf",
  steps: [{ id: "s1", title: "Review the request" }],
  flowSteps: [{ id: "f1", title: "Flow one" }],
};

// The flex container that orders the metrics and tabs must not also hold the tab content,
// otherwise the content (order 0) is laid out before them.
function orderedBlockSharesFlexParentWithContent(ordered: Element, content: Element): boolean {
  const parent = ordered.closest("[class*='max-md:order-']")?.parentElement;
  if (parent === null || parent === undefined) return false;
  return Array.from(parent.children).some(
    (child) => child.contains(content) && !/max-md:order-[3-9]/.test(child.className),
  );
}

describe("projectionDetail on a phone", () => {
  restoreViewportWidthAfterEach();

  test("metrics and tabs are not ordered inside the container that holds the tab content", async () => {
    setViewportWidth(390);
    renderScreen(requestFile, fileRecord);
    const tabs = await screen.findByTestId("kumiko-screen-projection-detail-tabs");
    const metrics = screen.getByTestId("kumiko-screen-projection-detail-metrics");
    const content = screen.getByText("Golf");
    expect(orderedBlockSharesFlexParentWithContent(metrics, content)).toBe(false);
    expect(orderedBlockSharesFlexParentWithContent(tabs, content)).toBe(false);
  });

  const footerScreen: ProjectionDetailScreenDefinition = {
    id: "approval",
    type: "projectionDetail",
    query: "shop:query:approval",
    layout: { sections: [{ title: "Text", fields: ["name"] }] },
    actions: [
      {
        kind: "writeHandler",
        id: "release",
        label: "Release",
        handler: "shop:write:release",
        style: "primary",
      },
      {
        kind: "writeHandler",
        id: "discard",
        label: "Discard",
        handler: "shop:write:discard",
        confirm: "Sure?",
        style: "danger",
        align: "start",
      },
    ],
    footerActions: ["discard", "release"],
  };

  test("footerActions with a start-aligned one show as buttons, not only the more-menu", async () => {
    setViewportWidth(390);
    renderScreen(footerScreen, { id: "r1", name: "x" });
    await waitFor(() => expect(screen.getByTestId("render-edit-action-release")).toBeTruthy());
    const release = screen.getByTestId("render-edit-action-release");
    const discard = screen.getByTestId("render-edit-action-discard");
    const footerRow = release.closest("[class*='h-14']");
    expect(footerRow).not.toBeNull();
    // Overflow content lives in a hidden host; visible buttons are direct row children.
    expect(release.closest(".hidden")).toBeNull();
    expect(discard.closest(".hidden")).toBeNull();
    expect(footerRow?.querySelector("[aria-label][data-testid$='-overflow']")).toBeNull();
  });
});
