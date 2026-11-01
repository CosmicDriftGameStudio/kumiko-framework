import { describe, expect, mock, test } from "bun:test";
import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  DispatcherProvider,
  ExtensionSectionsProvider,
  RenderEdit,
  useExtensionFormSubmit,
} from "../../index.ts";
import { makeDispatcher, orderEntity, type TestValues } from "./_render-edit-helpers.tsx";
import { fireEvent, render, renderWithPrimitivesOverride, screen, waitFor } from "./test-utils.tsx";

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
  test("the rail shows the current step's description and no row subtitles without a subtitle", () => {
    renderWizard(wizardScreen(describedSections));
    expect(screen.getAllByText("Name the order.")).toHaveLength(2);
    const narrowOnly = screen
      .getAllByText("Name the order.")
      .filter((copy) => copy.className.includes("lg:hidden"));
    expect(narrowOnly).toHaveLength(1);
    expect(screen.getAllByText("Count the items.")).toHaveLength(1);
    for (const index of [0, 1, 2]) {
      expect(screen.queryByTestId(`render-edit-wizard-steps-subtitle-${index}`)).toBeNull();
    }
  });

  test("advancing replaces the intro text instead of keeping step 1's", () => {
    renderWizard(wizardScreen(describedSections));
    next();
    // Step 1 stays mounted but hidden: only its own header copy remains, the rail intro moved on.
    expect(screen.getAllByText("Name the order.")).toHaveLength(1);
    expect(screen.getAllByText("Count the items.")).toHaveLength(2);
  });

  test("without a rendered rail the step description stays in the section header", () => {
    renderWithPrimitivesOverride(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <RenderEdit<TestValues>
          screen={wizardScreen(describedSections)}
          entity={orderEntity}
          featureName="orders"
          initial={{ title: "Acme", count: 1, isUrgent: false } as TestValues}
          writeCommand="order:create"
          fillScreenHeight
        />
      </DispatcherProvider>,
      { StepBar: undefined },
    );
    expect(screen.getByText("Name the order.").className).not.toContain("lg:hidden");
    expect(screen.queryByTestId("render-edit-wizard-steps")).toBeNull();
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

  test("describes the next step with its subtitle only, never its description", () => {
    renderWizard(
      wizardScreen(
        [
          { title: "Basics", columns: 1, fields: [{ field: "title" }] },
          {
            title: "Details",
            subtitle: "Short line",
            description: "Long intro",
            columns: 1,
            fields: [{ field: "count" }],
          },
        ],
        { aside: { upNext: true } },
      ),
    );
    const upNext = screen.getByTestId("render-edit-wizard-steps-up-next");
    expect(upNext.textContent).toContain("Details");
    expect(upNext.textContent).toContain("Short line");
    expect(upNext.textContent).not.toContain("Long intro");
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

const Noop = (_: { entityName: string; entityId: string | null }) => <div />;

describe("wizard step rail: extension steps", () => {
  function renderWithExtensionFirst(summaryField: string) {
    return render(
      <DispatcherProvider dispatcher={makeDispatcher()}>
        <ExtensionSectionsProvider value={{ Noop }}>
          <RenderEdit<TestValues>
            screen={wizardScreen([
              {
                kind: "extension",
                title: "Custom",
                description: "Custom intro",
                subtitle: "Custom line",
                summaryField,
                component: { react: { __component: "Noop" } },
              },
              { title: "Basics", columns: 1, fields: [{ field: "title" }] },
            ])}
            entity={orderEntity}
            featureName="orders"
            initial={{ title: "Acme", count: 1, isUrgent: false } as TestValues}
            writeCommand="order:create"
            fillScreenHeight
          />
        </ExtensionSectionsProvider>
      </DispatcherProvider>,
    );
  }

  test("subtitle and description of an extension step reach the rail", () => {
    renderWithExtensionFirst("title");
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-0").textContent).toBe(
      "Custom line",
    );
    expect(screen.getAllByText("Custom intro").length).toBeGreaterThan(0);
  });

  test("a done extension step summarises a field of another section", () => {
    renderWithExtensionFirst("title");
    next();
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-0").textContent).toBe("Acme");
  });

  test("a done extension step summarises a form value no section lists", () => {
    renderWithExtensionFirst("count");
    next();
    expect(screen.getByTestId("render-edit-wizard-steps-subtitle-0").textContent).toBe("1");
  });
});

describe("wizard footer: last step", () => {
  function gotoLastStep(wizard?: WizardLayout): void {
    renderWizard(wizardScreen(describedSections, wizard));
    next();
    next();
  }

  test("Save and close stays hidden on the last step by default", () => {
    gotoLastStep();
    expect(screen.queryByTestId("render-edit-wizard-save-close")).toBeNull();
    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
  });

  test("with saveAndCloseOnCreate it sits next to the submit on the last step", () => {
    gotoLastStep({ saveAndCloseOnCreate: true });
    expect(screen.getByTestId("render-edit-wizard-save-close")).toBeTruthy();
    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
  });
});
