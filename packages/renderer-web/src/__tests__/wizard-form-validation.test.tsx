// fw#1910: the auto-wired entityEdit path never set RenderEdit's `schema`
// prop, so the wizard's per-step "Next" validation was a no-op — a
// required field left empty on step 1 still advanced to step 2. This test
// covers the fix end to end (KumikoScreen → EntityEditCreateBody →
// RenderEdit) with real DOM primitives, not a hand-rolled unit call.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen } from "./test-utils";

const profileEntity = {
  fields: {
    fullName: { type: "text", required: true },
    email: { type: "text", required: false },
  },
} as unknown as EntityDefinition;

const wizardScreen: EntityEditScreenDefinition = {
  id: "profile-edit",
  type: "entityEdit",
  entity: "profile",
  layout: {
    mode: "wizard",
    sections: [
      { title: "Step 1", fields: ["fullName"] },
      { title: "Step 2", fields: ["email"] },
    ],
  },
};

const schema: FeatureSchema = {
  featureName: "demo",
  entities: { profile: profileEntity },
  screens: [wizardScreen],
};

function renderWizard() {
  return render(
    <DispatcherProvider dispatcher={createMockDispatcher()}>
      <KumikoScreen schema={schema} qn="demo:screen:profile-edit" />
    </DispatcherProvider>,
  );
}

describe("entityEdit wizard — presence validation on Next (fw#1910)", () => {
  test("empty required field blocks the step transition and shows a field error", async () => {
    renderWizard();

    await userEvent.click(screen.getByTestId("render-edit-wizard-next"));

    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("1");
    expect(screen.getByTestId("field-fullName-errors")).toBeTruthy();
    // Step 2's field stays mounted but hidden — the transition was blocked.
    expect(screen.getByTestId("field-email").closest("[hidden]")).not.toBeNull();
  });

  test("filling the required field allows Next to advance to step 2", async () => {
    const { container } = renderWizard();

    const fullNameInput = container.querySelector("#kumiko-edit-fullName");
    expect(fullNameInput).toBeTruthy();
    await userEvent.type(fullNameInput as Element, "Ada Lovelace");
    await userEvent.click(screen.getByTestId("render-edit-wizard-next"));

    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("2");
    expect(screen.queryByTestId("field-fullName-errors")).toBeNull();
  });
});

// fw#1966: the wizard chrome used to only show a "Step X of Y" counter —
// no way to see what the remaining steps are called. The step bar renders
// every section title up front and marks the current one.
describe("entityEdit wizard — step bar (fw#1966)", () => {
  test("shows every section title as a step entry", () => {
    renderWizard();

    expect(screen.getByTestId("render-edit-wizard-steps-step-0").textContent).toContain("Step 1");
    expect(screen.getByTestId("render-edit-wizard-steps-step-1").textContent).toContain("Step 2");
  });

  test("marks the active step and moves the marker forward on Next", async () => {
    const { container } = renderWizard();

    expect(screen.getByTestId("render-edit-wizard-steps-step-0").getAttribute("aria-current")).toBe(
      "step",
    );
    expect(
      screen.getByTestId("render-edit-wizard-steps-step-1").getAttribute("aria-current"),
    ).toBeNull();

    const fullNameInput = container.querySelector("#kumiko-edit-fullName");
    await userEvent.type(fullNameInput as Element, "Ada Lovelace");
    await userEvent.click(screen.getByTestId("render-edit-wizard-next"));

    expect(
      screen.getByTestId("render-edit-wizard-steps-step-0").getAttribute("aria-current"),
    ).toBeNull();
    expect(screen.getByTestId("render-edit-wizard-steps-step-1").getAttribute("aria-current")).toBe(
      "step",
    );
  });

  test("a wizard with N sections renders N step entries", () => {
    const threeStepScreen: EntityEditScreenDefinition = {
      id: "profile-edit-3",
      type: "entityEdit",
      entity: "profile",
      layout: {
        mode: "wizard",
        sections: [
          { title: "Basics", fields: ["fullName"] },
          { title: "Contact", fields: ["email"] },
          { title: "Review", fields: [] },
        ],
      },
    };
    const threeStepSchema: FeatureSchema = {
      featureName: "demo",
      entities: { profile: profileEntity },
      screens: [threeStepScreen],
    };
    const { container } = render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <KumikoScreen schema={threeStepSchema} qn="demo:screen:profile-edit-3" />
      </DispatcherProvider>,
    );

    const steps = container.querySelectorAll('[data-testid^="render-edit-wizard-steps-step-"]');
    expect(steps.length).toBe(3);
  });
});
