// A wizard editing an existing record: steps show done by what the record
// already holds (not by position), every non-current step is a jump target,
// and leaving the current step still goes through its validate gate.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { ExtensionSectionProps, FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  KumikoScreen,
  useReportStepComplete,
} from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const profileEntity = {
  fields: {
    fullName: { type: "text", required: true },
    email: { type: "text", required: false },
    count: { type: "number", required: false },
    price: { type: "money", required: false },
    active: { type: "boolean", required: false },
    kind: { type: "select", required: false, options: ["a", "b"] },
    notes: { type: "text", required: false },
  },
} as unknown as EntityDefinition;

const wizardScreen: EntityEditScreenDefinition = {
  id: "profile-edit",
  type: "entityEdit",
  entity: "profile",
  layout: {
    mode: "wizard",
    sections: [
      { title: "Basics", fields: ["fullName"] },
      { title: "Contact", fields: ["email"] },
      { title: "Fresh", fields: ["count", "price", "active", "kind"] },
      {
        kind: "extension",
        title: "Reporter",
        component: { react: { __component: "ReportsComplete" } },
      },
      {
        kind: "extension",
        title: "Silent",
        component: { react: { __component: "NeverReports" } },
      },
      { title: "Last", fields: ["notes"] },
    ],
  },
};

const schema: FeatureSchema = {
  featureName: "demo",
  entities: { profile: profileEntity },
  screens: [wizardScreen],
};

function ReportsComplete({ reportStepComplete }: ExtensionSectionProps) {
  useReportStepComplete(reportStepComplete, true);
  return <div data-testid="reports-complete" />;
}

function NeverReports() {
  return <div data-testid="never-reports" />;
}

// NULL columns of an existing record: the renderer seeds them with "" / 0 /
// {amount: 0}; boolean and select carry real stored values.
const existingRecord = {
  id: "p-1",
  version: 1,
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  count: null,
  price: null,
  active: false,
  kind: "a",
  notes: null,
};

async function renderEditWizard(record: Record<string, unknown> = existingRecord) {
  const dispatcher = createMockDispatcher({
    query: (async () => ({ isSuccess: true, data: record })) as unknown as Dispatcher["query"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <ExtensionSectionsProvider value={{ ReportsComplete, NeverReports }}>
        <KumikoScreen schema={schema} qn="demo:screen:profile-edit" entityId="p-1" />
      </ExtensionSectionsProvider>
    </DispatcherProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("render-edit-wizard-steps-step-0")).toBeTruthy());
}

function chip(index: number): HTMLElement {
  return screen.getByTestId(`render-edit-wizard-steps-step-${index}`);
}

function isDone(index: number): boolean {
  return chip(index).textContent?.includes("Done") === true;
}

function currentChipIndex(): number {
  return [0, 1, 2, 3, 4, 5].find((i) => chip(i).getAttribute("aria-current") === "step") ?? -1;
}

describe("entityEdit wizard on an existing record: done state", () => {
  test("a fields step holding valid user data shows done without having been visited", async () => {
    await renderEditWizard();

    expect(currentChipIndex()).toBe(0);
    expect(isDone(1)).toBe(true);
  });

  test("a fresh-record step (empty seeds, prefilled select, false boolean) is not done", async () => {
    await renderEditWizard();

    expect(isDone(2)).toBe(false);
    expect(isDone(5)).toBe(false);
  });

  test("an extension step is done once it reports completeness, and not before", async () => {
    await renderEditWizard();

    expect(isDone(3)).toBe(true);
    expect(isDone(4)).toBe(false);
  });

  test("passing a step with Next marks it done, even an extension step that never reports", async () => {
    await renderEditWizard();

    await userEvent.click(chip(4));
    expect(currentChipIndex()).toBe(4);
    expect(isDone(4)).toBe(false);

    await userEvent.click(screen.getByTestId("render-edit-wizard-next"));

    expect(currentChipIndex()).toBe(5);
    expect(isDone(4)).toBe(true);
  });

  test("a forward chip jump does not mark the step it leaves as passed", async () => {
    await renderEditWizard();

    await userEvent.click(chip(2));
    await userEvent.click(chip(5));

    expect(currentChipIndex()).toBe(5);
    expect(isDone(2)).toBe(false);
  });
});

describe("entityEdit wizard on an existing record: jumping", () => {
  test("upcoming chips are buttons and a click jumps there without clicking through", async () => {
    await renderEditWizard();

    expect(chip(3).tagName).toBe("BUTTON");
    expect(chip(0).tagName).toBe("SPAN");

    await userEvent.click(chip(3));

    expect(currentChipIndex()).toBe(3);
    expect(screen.getByTestId("render-edit-wizard-step-label").textContent).toContain("4");
  });

  test("a forward jump from a step with an invalid required field is blocked and shows the error", async () => {
    await renderEditWizard();
    // An unchanged empty legacy value stays valid (buildFormSchema unchangedFrom), so the user has to clear it.
    await userEvent.clear(document.querySelector("#kumiko-edit-fullName") as Element);

    await userEvent.click(chip(2));

    expect(currentChipIndex()).toBe(0);
    expect(screen.getByTestId("field-fullName-errors")).toBeTruthy();
  });

  test("a forward jump from a valid step succeeds", async () => {
    await renderEditWizard();

    await userEvent.click(chip(2));

    expect(currentChipIndex()).toBe(2);
    expect(screen.queryByTestId("field-fullName-errors")).toBeNull();
  });

  test("a backward chip jump still works", async () => {
    await renderEditWizard();

    await userEvent.click(chip(3));
    await userEvent.click(chip(0));

    expect(currentChipIndex()).toBe(0);
  });

  test("the compact picker jumps to another step, and a forward jump from an invalid step stays put", async () => {
    await renderEditWizard();
    const toggle = screen.getByTestId("render-edit-wizard-step-label");

    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId("render-edit-wizard-step-label-step-3"));
    expect(currentChipIndex()).toBe(3);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(chip(0));
    await userEvent.clear(document.querySelector("#kumiko-edit-fullName") as Element);
    await userEvent.click(toggle);
    await userEvent.click(screen.getByTestId("render-edit-wizard-step-label-step-2"));
    expect(currentChipIndex()).toBe(0);
    expect(screen.getByTestId("field-fullName-errors")).toBeTruthy();
  });
});
