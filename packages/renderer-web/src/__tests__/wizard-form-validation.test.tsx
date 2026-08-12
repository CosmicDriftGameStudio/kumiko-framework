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
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
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

  // handleWizardNext validates only the CURRENT step's fields
  // (render-edit.tsx:679) — an unscoped controller.validate() regression
  // would block Next on step 1 for a required field that only exists on
  // step 2, permanently stuck on step 1. Submit must still enforce it.
  test("a required field on a later step never blocks Next on an earlier step, but blocks submit", async () => {
    const requiredEmailEntity = {
      fields: {
        fullName: { type: "text", required: true },
        email: { type: "text", required: true },
      },
    } as unknown as EntityDefinition;
    const requiredEmailSchema: FeatureSchema = {
      featureName: "demo",
      entities: { profile: requiredEmailEntity },
      screens: [wizardScreen],
    };
    const { container } = render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <KumikoScreen schema={requiredEmailSchema} qn="demo:screen:profile-edit" />
      </DispatcherProvider>,
    );

    const fullNameInput = container.querySelector("#kumiko-edit-fullName");
    await userEvent.type(fullNameInput as Element, "Ada Lovelace");
    await userEvent.click(screen.getByTestId("render-edit-wizard-next"));

    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("2");

    await userEvent.click(screen.getByTestId("render-edit-submit"));

    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("2");
    expect(screen.getByTestId("field-email-errors")).toBeTruthy();
  });

  // `fieldset[disabled]` also excludes its descendants' controls from a real
  // `new FormData(form)` / native form submission — if render-edit's submit
  // path ever read values that way instead of from controller/React state,
  // disabling step 1's fieldset after Next would silently drop fullName on
  // submit. Assert on the value the dispatcher actually receives, not just
  // that step 2 shows no error.
  test("submitting from a later step still sends an earlier step's value to the dispatcher", async () => {
    const calls: Array<[string, unknown]> = [];
    const write = (async (type: string, payload: unknown) => {
      calls.push([type, payload]);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"];
    const { container } = render(
      <DispatcherProvider dispatcher={createMockDispatcher({ write })}>
        <KumikoScreen schema={schema} qn="demo:screen:profile-edit" />
      </DispatcherProvider>,
    );

    const fullNameInput = container.querySelector("#kumiko-edit-fullName");
    await userEvent.type(fullNameInput as Element, "Ada Lovelace");
    await userEvent.click(screen.getByTestId("render-edit-wizard-next"));
    await userEvent.click(screen.getByTestId("render-edit-submit"));

    expect(calls).toHaveLength(1);
    const [, payload] = calls[0] as [string, Record<string, unknown>];
    expect(payload["fullName"]).toBe("Ada Lovelace");
  });

  // fw high-severity finding: `hidden` alone does not bar a field from the
  // browser's native constraint validation, so a required field on an
  // off-screen step blocked the whole form's `type="submit"` Next button —
  // jsdom doesn't implement constraint validation, so this only reproduces
  // as a DOM-shape check (fieldset[disabled] ancestor), not the actual
  // browser-blocks-navigation symptom.
  test("an off-screen step's fields sit inside a disabled fieldset, the current step's don't", async () => {
    renderWizard();

    const hiddenStepField = screen.getByTestId("field-email").closest("fieldset");
    expect(hiddenStepField?.disabled).toBe(true);

    const currentStepField = screen.getByTestId("field-fullName").closest("fieldset");
    expect(currentStepField?.disabled).toBe(false);
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
