import { describe, expect, mock, test } from "bun:test";
import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  RenderEdit,
  useExtensionFormSubmit,
} from "../../index.ts";
import { makeDispatcher, orderEntity, type TestValues } from "./_render-edit-helpers.tsx";
import { fireEvent, render, screen, waitFor } from "./test-utils.tsx";

type WizardLayout = NonNullable<EntityEditScreenDefinition["layout"]["wizard"]>;
type SectionSpecs = EntityEditScreenDefinition["layout"]["sections"];

function wizardScreen(sections: SectionSpecs, wizard?: WizardLayout): EntityEditScreenDefinition {
  return {
    id: "orders:screen:order-wizard",
    type: "entityEdit",
    entity: "order",
    layout: { mode: "wizard", sections, ...(wizard !== undefined && { wizard }) },
  };
}

const describedSections: SectionSpecs = [
  { title: "Basics", description: "Name the order.", columns: 1, fields: [{ field: "title" }] },
  { title: "Details", description: "Count the items.", columns: 1, fields: [{ field: "count" }] },
  { title: "Notes", description: "Anything else?", columns: 1, fields: [{ field: "notes" }] },
];

function renderWizard(screenDef: EntityEditScreenDefinition, props: { entityId?: string } = {}) {
  return render(
    <DispatcherProvider dispatcher={makeDispatcher()}>
      <RenderEdit<TestValues>
        screen={screenDef}
        entity={orderEntity}
        featureName="orders"
        initial={{ title: "Acme", count: 1, isUrgent: false } as TestValues}
        writeCommand={props.entityId === undefined ? "order:create" : "order:update"}
        fillScreenHeight
        {...(props.entityId !== undefined && { entityId: props.entityId })}
      />
    </DispatcherProvider>,
  );
}

function next(): void {
  fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
}

describe("wizard step rail: per-step texts", () => {
  test("the rail shows the current step's description once, and the other steps' as row subtitles", () => {
    renderWizard(wizardScreen(describedSections));
    expect(screen.getAllByText("Name the order.")).toHaveLength(1);
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-1").textContent).toBe(
      "Count the items.",
    );
    expect(screen.queryByTestId("render-edit-wizard-steps-subtitle-0")).toBeNull();
  });

  test("advancing replaces the intro text instead of keeping step 1's", () => {
    renderWizard(wizardScreen(describedSections));
    next();
    expect(screen.getAllByText("Name the order.")).toHaveLength(1);
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-0").textContent).toBe(
      "Name the order.",
    );
    expect(screen.getAllByText("Count the items.")).toHaveLength(1);
    expect(screen.queryByTestId("render-edit-wizard-steps-subtitle-1")).toBeNull();
  });

  test("an explicit subtitle wins over the description in the row", () => {
    renderWizard(
      wizardScreen([
        { title: "Basics", columns: 1, fields: [{ field: "title" }] },
        {
          title: "Details",
          subtitle: "Short line",
          description: "Long intro",
          columns: 1,
          fields: [{ field: "count" }],
        },
      ]),
    );
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-1").textContent).toBe(
      "Short line",
    );
  });

  test("a completed step shows the summaryField value under its label", () => {
    renderWizard(
      wizardScreen([
        { title: "Basics", summaryField: "title", columns: 1, fields: [{ field: "title" }] },
        { title: "Details", columns: 1, fields: [{ field: "count" }] },
      ]),
    );
    expect(screen.queryByTestId("render-edit-wizard-steps-subtitle-0")).toBeNull();
    next();
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-0").textContent).toBe("Acme");
  });
});

describe("wizard step rail: up-next card", () => {
  const aside = { aside: { upNext: true as const, finishDescription: "Creates the order." } };

  test("describes the next step with its description", () => {
    renderWizard(wizardScreen(describedSections, { aside: { upNext: true } }));
    const upNext = screen.getByTestId("render-edit-wizard-steps-up-next");
    expect(upNext.textContent).toContain("Details");
    expect(upNext.textContent).toContain("Count the items.");
  });

  test("on the last step it announces the finish action with its description", () => {
    renderWizard(wizardScreen(describedSections, aside));
    next();
    next();
    const upNext = screen.getByTestId("render-edit-wizard-steps-up-next");
    expect(upNext.textContent).toContain("Finish");
    expect(upNext.textContent).toContain("Creates the order.");
  });

  test("without finishDescription the last step shows no card", () => {
    renderWizard(wizardScreen(describedSections, { aside: { upNext: true } }));
    next();
    next();
    expect(screen.queryByTestId("render-edit-wizard-steps-up-next")).toBeNull();
  });
});

describe("wizard footer", () => {
  test("Save and close is offered while creating only with saveAndCloseOnCreate", () => {
    const view = renderWizard(wizardScreen(describedSections));
    expect(screen.queryByTestId("render-edit-wizard-save-close")).toBeNull();
    view.unmount();
    renderWizard(wizardScreen(describedSections, { saveAndCloseOnCreate: true }));
    expect(screen.getByTestId("render-edit-wizard-save-close")).toBeTruthy();
  });

  test("submitDisabledWhen disables Finish while the condition holds", () => {
    renderWizard(
      wizardScreen(describedSections, { submitDisabledWhen: { field: "title", eq: "blocked" } }),
    );
    next();
    next();
    const setTitle = (value: string) =>
      fireEvent.change(
        screen.getByTestId("field-title").querySelector("input") as HTMLInputElement,
        {
          target: { value },
        },
      );
    const finishDisabled = () =>
      (screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled;
    setTitle("ok");
    expect(finishDisabled()).toBe(false);
    setTitle("blocked");
    expect(finishDisabled()).toBe(true);
  });

  test("an extension step is persisted with the id of the record created by the wizard", async () => {
    const submitSpy = mock();
    // biome-ignore lint/correctness/noComponentHookFactories: closes over the test-local submitSpy; defined once per test run
    const ComposedCF = (_: { entityName: string; entityId: string | null }) => {
      useExtensionFormSubmit({
        dirty: true,
        onSubmit: async (ctx) => {
          submitSpy(ctx);
          return { isSuccess: true as const };
        },
      });
      return <div data-testid="composed-cf" />;
    };
    const screenDef = wizardScreen([
      { title: "Basics", columns: 1, fields: [{ field: "title" }] },
      {
        kind: "extension",
        title: "Custom Fields",
        component: { react: { __component: "ComposedCF" } },
        contributesToFormSubmit: true,
      },
    ]);
    render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ ComposedCF }}>
          <RenderEdit<TestValues>
            screen={screenDef}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 0 } as TestValues}
            writeCommand="order:create"
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
    fireEvent.change(screen.getByTestId("field-title").querySelector("input") as HTMLInputElement, {
      target: { value: "Changed" },
    });
    next();
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith({ entityId: "1" }));
  });
});
