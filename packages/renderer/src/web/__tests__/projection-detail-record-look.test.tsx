// Record page options of the board look: fact grid, section titles, page navigation, photos
// beside, metric visibility, mobile summary, narrow order, concealed values, iconless banner.
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
} from "./test-utils.tsx";

const record = {
  id: "r1",
  title: "Request",
  status: "open",
  receivedAt: "RECEIVED-NOW",
  windowLabel: "WINDOW-3-DAYS",
  make: "VW",
  model: "Golf",
  secret: "hidden-value",
  line: "Short phone line",
  notice: { title: "Heads up", text: "Check" },
  steps: [{ id: "s1", title: "Review the request" }],
};

type Sections = ProjectionDetailScreenDefinition["layout"]["sections"];

function renderScreen(
  {
    tabs,
    ...extra
  }: Omit<Partial<ProjectionDetailScreenDefinition>, "layout"> & {
    readonly tabs?: true;
  },
  sections: Sections,
): void {
  const query = (async () => ({
    isSuccess: true,
    data: record,
  })) as unknown as Dispatcher["query"];
  const definition = {
    id: "file",
    type: "projectionDetail",
    query: "shop:query:file",
    valueDisplay: "text",
    ...extra,
    layout: { ...(tabs === true && { mode: "tabs" }), sections },
  } as ProjectionDetailScreenDefinition;
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "shop", entities: {}, screens: [definition] }}
        qn="shop:screen:file"
        entityId="r1"
      />
    </DispatcherProvider>,
  );
}

const twoFields = ["make", "model"];

describe("fact grid in read mode", () => {
  test("a section with declared columns draws a label/value grid", async () => {
    renderScreen({}, [{ title: "Data", columns: 2, fields: twoFields }]);
    await screen.findByText("Golf");
    expect(document.querySelector("[data-facts]")).not.toBeNull();
  });

  test("without declared columns the stacked layout stays, also for groups in tabs", async () => {
    renderScreen({ tabs: true }, [
      { id: "a", title: "Data", groups: [{ title: "Group", fields: twoFields }] },
    ]);
    await screen.findByText("Golf");
    expect(document.querySelector("[data-facts]")).toBeNull();
  });

  test("a group with declared columns draws the grid", async () => {
    renderScreen({ tabs: true }, [
      { id: "a", title: "Data", groups: [{ title: "Group", columns: 2, fields: twoFields }] },
    ]);
    await screen.findByText("Golf");
    expect(document.querySelector("[data-facts]")).not.toBeNull();
  });
});

describe("section titles and page navigation", () => {
  const stacked: Sections = [
    { title: "Alpha", fields: ["make"] },
    { title: "Beta", fields: ["model"] },
    { title: "Gamma", fields: ["secret"] },
  ];

  test("the page navigation lists the sections by default", async () => {
    renderScreen({}, stacked);
    await screen.findByText("Golf");
    expect(screen.queryByTestId("form-section-nav")).not.toBeNull();
  });

  test("pageNavigation false leaves it out", async () => {
    renderScreen({ pageNavigation: false }, stacked);
    await screen.findByText("Golf");
    expect(screen.queryByTestId("form-section-nav")).toBeNull();
  });

  test("the first section of a tab drops its title, which the tab already shows", async () => {
    renderScreen({ tabs: true }, [
      { id: "a", title: "Alpha", fields: ["make"] },
      { id: "a", title: "Beta", fields: ["model"] },
    ]);
    await screen.findByText("Golf");
    expect(screen.getAllByText("Alpha")).toHaveLength(1);
    expect(screen.getAllByText("Beta")).toHaveLength(1);
  });
});

describe("photos beside the data", () => {
  test("a tab with fields and a photo grid puts them in two columns", async () => {
    renderScreen({ photosBeside: true, tabs: true }, [
      { id: "a", title: "Data", fields: twoFields },
      {
        id: "a",
        kind: "relatedList",
        title: "Photos",
        query: "shop:query:photos",
        parentParam: "requestId",
        columns: [{ field: "label", label: "Label" }],
        photoGrid: { imageField: "photo" },
      },
    ]);
    await screen.findByText("Golf");
    expect(screen.queryByTestId("record-photos-beside")).not.toBeNull();
  });
});

describe("metrics", () => {
  test("a metric with visibleWhen shows only while the condition holds", async () => {
    renderScreen(
      {
        metrics: [
          { field: "receivedAt", label: "Received", visibleWhen: { field: "status", eq: "open" } },
          { field: "windowLabel", label: "Window", visibleWhen: { field: "status", eq: "done" } },
        ],
      },
      [{ title: "Data", fields: twoFields }],
    );
    await screen.findByText("RECEIVED-NOW");
    expect(screen.queryByText("WINDOW-3-DAYS")).toBeNull();
  });

  test("mobileSummary adds one summary line and keeps the metrics in the DOM once", async () => {
    renderScreen({ mobileSummary: "line", metrics: [{ field: "receivedAt", label: "Received" }] }, [
      { title: "Data", fields: twoFields },
    ]);
    await screen.findByText("RECEIVED-NOW");
    expect(screen.getAllByText("Short phone line")).toHaveLength(1);
    expect(screen.getAllByText("RECEIVED-NOW")).toHaveLength(1);
  });
});

describe("narrow order before the steps", () => {
  restoreViewportWidthAfterEach();

  test("the steps come after the metrics and the tabs after the steps", async () => {
    setViewportWidth(390);
    renderScreen(
      {
        tabs: true,
        metrics: [{ field: "receivedAt", label: "Received" }],
        metricsPlacement: { narrow: "before-steps" },
        steps: { field: "steps" },
      },
      [{ id: "a", title: "Data", fields: twoFields }],
    );
    const tabs = await screen.findByTestId("kumiko-screen-projection-detail-tabs");
    expect(tabs.closest("[class*='max-md:order-3']")).not.toBeNull();
    expect(
      screen.getByText("Review the request").closest("[class*='max-md:order-2']"),
    ).not.toBeNull();
  });
});

describe("concealed values and the iconless banner", () => {
  test("a concealed field shows its value muted with a lock", async () => {
    renderScreen({}, [{ title: "Data", fields: [{ field: "secret", concealed: true }] }]);
    const value = await screen.findByTestId("field-value-secret");
    expect(value.hasAttribute("data-concealed")).toBe(true);
    expect(value.querySelector("svg")).not.toBeNull();
  });

  test("banner.iconless leaves the tone icon out", async () => {
    renderScreen({ banner: { field: "notice", iconless: true } }, [
      { title: "Data", fields: twoFields },
    ]);
    const banner = await screen.findByTestId("kumiko-screen-projection-detail-banner");
    expect(banner.querySelector("svg")).toBeNull();
  });

  test("the banner keeps the tone icon by default", async () => {
    renderScreen({ banner: { field: "notice" } }, [{ title: "Data", fields: twoFields }]);
    const banner = await screen.findByTestId("kumiko-screen-projection-detail-banner");
    expect(banner.querySelector("svg")).not.toBeNull();
  });
});

describe("groups and section hint of a stacked record page", () => {
  test("section.groups render as labelled facts grids", async () => {
    renderScreen({}, [
      {
        title: "Data",
        groups: [{ title: "Vehicle", columns: 2, fields: twoFields }],
      },
    ]);
    await screen.findByText("Golf");
    expect(screen.getByTestId("section-Data-group-0")).toBeTruthy();
    expect(screen.getByText("Vehicle")).toBeTruthy();
    expect(document.querySelector("[data-facts]")).not.toBeNull();
  });

  test("the section description sits under the data with the first sentence bold", async () => {
    renderScreen({}, [
      { title: "Data", description: "Photos checked. Nothing to do here.", fields: twoFields },
    ]);
    await screen.findByText("Golf");
    const hint = screen.getByTestId("section-Data-hint");
    expect(hint.querySelector("strong")?.textContent).toBe("Photos checked.");
    expect(hint.textContent).toBe("Photos checked. Nothing to do here.");
    const field = screen.getByText("Golf");
    expect(field.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("on the phone the section description leads the data", async () => {
    renderScreen({}, [{ title: "Data", description: "Photos checked.", fields: twoFields }]);
    await screen.findByText("Golf");
    const hint = screen.getByTestId("section-Data-hint");
    expect(hint.className).toContain("max-sm:order-first");
    expect(hint.parentElement?.className).toContain("flex-col");
  });
});

describe("title block", () => {
  test("the status chip sits next to the H1 in the title block", async () => {
    renderScreen({ header: { title: "title", status: "status" } }, [
      { title: "Data", fields: twoFields },
    ]);
    const title = await screen.findByTestId("kumiko-screen-projection-detail-title");
    const chip = screen.getByTestId("kumiko-screen-projection-detail-status");
    expect(chip.parentElement).toBe(title.parentElement);
  });
});
