// Phone variants of the record guidance blocks: short summary, limited steps, hidden chain, step subtitle.
import { describe, expect, test } from "bun:test";
import type { ProjectionDetailScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import {
  createMockDispatcher,
  fireEvent,
  type MockQueryHandler,
  render,
  restoreViewportWidthAfterEach,
  screen,
  setViewportWidth,
  waitFor,
} from "./test-utils.tsx";

const PHONE_WIDTH = 500;
const DESKTOP_WIDTH = 1280;

function detailScreen(
  extras: Partial<ProjectionDetailScreenDefinition>,
): ProjectionDetailScreenDefinition {
  return {
    id: "unit-detail",
    type: "projectionDetail",
    query: "shop:query:unit:detail",
    layout: { sections: [{ title: "Unit", fields: ["name"] }] },
    ...extras,
  };
}

function renderDetail(screenDefinition: ProjectionDetailScreenDefinition): void {
  const query: MockQueryHandler = async () => ({ isSuccess: true, data: RECORD });
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({ query })}>
      <KumikoScreen
        schema={{ featureName: "shop", entities: {}, screens: [screenDefinition] }}
        qn="shop:screen:unit-detail"
        entityId="u1"
      />
    </DispatcherProvider>,
  );
}

const RECORD = {
  id: "u1",
  name: "Unit 1",
  line: "A long sentence about the whole state of this unit.",
  shortLine: "Short state.",
  steps: ["a", "b", "c", "d", "e"].map((id) => ({ id, title: `Step ${id}` })),
  progress: [
    {
      title: "Rental",
      currentIndex: 1,
      steps: [
        { id: "x", label: "Booked", done: true },
        { id: "y", label: "Handover", done: false },
        { id: "z", label: "Done", done: false },
      ],
    },
  ],
};

describe("record guidance on a phone", () => {
  restoreViewportWidthAfterEach();

  test("narrowField replaces the summary below sm and not above", async () => {
    const definition = detailScreen({ summary: { field: "line", narrowField: "shortLine" } });
    setViewportWidth(PHONE_WIDTH);
    renderDetail(definition);
    await waitFor(() => screen.getByText("Short state."));
    expect(screen.queryByText(RECORD.line)).toBeNull();
  });

  test("the full summary stays on a wide screen", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDetail(detailScreen({ summary: { field: "line", narrowField: "shortLine" } }));
    await waitFor(() => screen.getByText(RECORD.line));
  });

  test("narrowLimit shows the first steps and a toggle for the rest", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDetail(detailScreen({ steps: { field: "steps", narrowLimit: 3 } }));
    await waitFor(() => screen.getByText("Step a"));
    expect(screen.queryByText("Step d")).toBeNull();
    const toggle = screen.getByText("2 more steps");
    fireEvent.click(toggle);
    screen.getByText("Step e");
    fireEvent.click(screen.getByText("Show fewer steps"));
    expect(screen.queryByText("Step d")).toBeNull();
  });

  test("a single hidden step reads as one step, not 1 steps", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDetail(detailScreen({ steps: { field: "steps", narrowLimit: 4 } }));
    await waitFor(() => screen.getByText("1 more step"));
  });

  test("narrowMoreLabel is the plural base key of the toggle of the rest", async () => {
    setViewportWidth(PHONE_WIDTH);
    renderDetail(
      detailScreen({
        steps: { field: "steps", narrowLimit: 4, narrowMoreLabel: "app.steps.more" },
      }),
    );
    // Keys without a bundle entry come back as the key itself: the toggle proves which key was asked.
    await waitFor(() => screen.getByText("app.steps.more.one"));
  });

  test("all steps show on a wide screen", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    renderDetail(detailScreen({ steps: { field: "steps", narrowLimit: 3 } }));
    await waitFor(() => screen.getByText("Step e"));
    expect(screen.queryByText("2 more steps")).toBeNull();
  });

  test("hideOnNarrow marks the chain as hidden below sm", async () => {
    renderDetail(detailScreen({ progress: { field: "progress", hideOnNarrow: true } }));
    await waitFor(() => screen.getByTestId("record-progress-0"));
    expect(screen.getByTestId("record-progress-0").closest(".max-sm\\:hidden")).not.toBeNull();
  });

  test("a chain next to the steps shows which step it is on", async () => {
    renderDetail(
      detailScreen({
        progress: { field: "progress", placement: "beside-steps" },
        steps: { field: "steps" },
      }),
    );
    await waitFor(() => screen.getByTestId("record-progress-0"));
    expect(screen.getByTestId("record-progress-0").textContent).toContain("Step 2 of 3");
  });
});
