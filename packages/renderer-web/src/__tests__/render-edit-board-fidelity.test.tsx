import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { DispatcherProvider, InsideDrawerProvider, RenderEdit } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { PageHeaderSlotProvider, usePageHeaderSlot } from "../layout/page-header-slot";
import { defaultPrimitives } from "../primitives";
import { createMockDispatcher, fireEvent, render, screen, waitFor, within } from "./test-utils";

const allRequiredEntity = {
  fields: {
    price: { type: "number", required: true },
    reason: { type: "text", required: true },
  },
} as unknown as EntityDefinition;

const mixedEntity = {
  fields: {
    price: { type: "number", required: true },
    reason: { type: "text" },
    notes: { type: "text", multiline: true },
  },
} as unknown as EntityDefinition;

function screenWith(fields: readonly string[]): EntityEditScreenDefinition {
  return {
    id: "orders:screen:order-edit",
    type: "entityEdit",
    entity: "order",
    layout: { sections: [{ columns: 2, fields: [...fields] }] },
  };
}

function renderEdit(entity: EntityDefinition, fields: readonly string[]): void {
  render(
    <DispatcherProvider dispatcher={createMockDispatcher({})}>
      <RenderEdit
        screen={screenWith(fields)}
        entity={entity}
        featureName="orders"
        initial={{}}
        writeCommand="order:create"
      />
    </DispatcherProvider>,
  );
}

describe("RenderEdit board fidelity", () => {
  test("all fields required: one hint replaces the per-field stars but inputs stay required", () => {
    renderEdit(allRequiredEntity, ["price", "reason"]);
    expect(screen.getByTestId("render-edit-all-required-hint")).toBeTruthy();
    expect(screen.getByTestId("field-price").textContent).not.toContain("*");
    expect(screen.getByLabelText(/price/i).getAttribute("aria-required")).toBe("true");
  });

  test("mixed required and optional fields keep the stars and show no hint", () => {
    renderEdit(mixedEntity, ["price", "reason"]);
    expect(screen.queryByTestId("render-edit-all-required-hint")).toBeNull();
    expect(screen.getByTestId("field-price").textContent).toContain("*");
  });

  test("flow grid cells take their width from the field type", () => {
    const { Grid, GridCell } = defaultPrimitives;
    render(
      <Grid columns={2} flow>
        <GridCell width="number">
          <span data-testid="n" />
        </GridCell>
        <GridCell width="full">
          <span data-testid="f" />
        </GridCell>
      </Grid>,
    );
    expect(screen.getByTestId("n").parentElement?.className).toContain("w-24");
    expect(screen.getByTestId("f").parentElement?.className).toContain("w-full");
  });

  test("in the shell header slot, Delete and Copy link move into the header menu and out of the footer", async () => {
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({})}>
        <PageHeaderSlotProvider>
          <ActionsHost />
          <RenderEdit
            screen={screenWith(["price", "reason"])}
            entity={allRequiredEntity}
            featureName="orders"
            initial={{}}
            writeCommand="order:update"
            fillScreenHeight
            onDelete={() => {}}
            onCopyLink={() => {}}
          />
        </PageHeaderSlotProvider>
      </DispatcherProvider>,
    );
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
    expect(screen.queryByTestId("render-edit-copy-link")).toBeNull();
    fireEvent.pointerDown(screen.getByTestId("render-edit-header-menu"), { button: 0 });
    fireEvent.click(screen.getByTestId("render-edit-header-menu"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
  });
  test("wizard footer: Back and Next carry chevrons, Delete and Cancel stay out of the footer", () => {
    const wizard: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          { title: "One", fields: ["price"] },
          { title: "Two", fields: ["reason"] },
        ],
      },
    };
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({})}>
        <PageHeaderSlotProvider>
          <ActionsHost />
          <RenderEdit
            screen={wizard}
            entity={allRequiredEntity}
            featureName="orders"
            initial={{ price: 1, reason: "x" }}
            writeCommand="order:update"
            fillScreenHeight
            onDelete={() => {}}
            onCancel={() => {}}
          />
        </PageHeaderSlotProvider>
      </DispatcherProvider>,
    );
    fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
    expect(screen.getByTestId("render-edit-wizard-back").querySelector("svg")).not.toBeNull();
    expect(screen.queryByTestId("render-edit-delete")).toBeNull();
    expect(screen.queryByTestId("render-edit-cancel")).toBeNull();
  });

  describe("wizard Save and close", () => {
    const wizard: EntityEditScreenDefinition = {
      id: "orders:screen:order-wizard",
      type: "entityEdit",
      entity: "order",
      layout: {
        mode: "wizard",
        sections: [
          { title: "One", fields: ["price"] },
          { title: "Two", fields: ["reason"] },
        ],
      },
    };

    function renderWizard(
      entityId: string | undefined,
      onSubmit: () => void,
      write = mock(async () => ({ isSuccess: true, data: { id: "o1" } })),
    ) {
      render(
        <DispatcherProvider dispatcher={createMockDispatcher({ write: write as never })}>
          <RenderEdit
            screen={wizard}
            entity={allRequiredEntity}
            featureName="orders"
            initial={{ price: 1, reason: "x" }}
            {...(entityId !== undefined && { entityId })}
            writeCommand="order:update"
            onSubmit={onSubmit}
          />
        </DispatcherProvider>,
      );
      return write;
    }

    test("an existing record shows a ghost button that saves and closes through onSubmit", async () => {
      const onSubmit = mock(() => {});
      const write = renderWizard("o1", onSubmit);
      const button = screen.getByTestId("render-edit-wizard-save-close");
      expect(button.className).toContain("text-primary");
      fireEvent.click(button);
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(write).toHaveBeenCalledTimes(1);
    });

    test("creating a new record hides it", () => {
      renderWizard(undefined, () => {});
      expect(screen.queryByTestId("render-edit-wizard-save-close")).toBeNull();
    });

    test("the last step hides it because the primary action already saves", () => {
      renderWizard("o1", () => {});
      fireEvent.click(screen.getByTestId("render-edit-wizard-next"));
      expect(screen.queryByTestId("render-edit-wizard-save-close")).toBeNull();
    });
  });

  test("drawer form: description, hint and fields stack in one column without a divider", () => {
    const { Form, Section, Grid, GridCell } = defaultPrimitives;
    render(
      <InsideDrawerProvider value>
        <Form onSubmit={() => {}} testId="drawer-form">
          <Section subtitle="Beschreibung" testId="s">
            <Grid columns={2} flow testId="g">
              <GridCell width="money">
                <span />
              </GridCell>
            </Grid>
          </Section>
        </Form>
      </InsideDrawerProvider>,
    );
    const grid = screen.getByTestId("g");
    expect(grid.className).toContain("flex-col");
    expect(grid.className).not.toContain("flex-wrap");
    expect(grid.firstElementChild?.className).toContain("sm:w-[200px]");
    expect(screen.getByTestId("drawer-form").querySelector("hr")).toBeNull();
  });

  test("flow grid aligns controls at the bottom and keeps number labels on one line", () => {
    const { Grid, GridCell } = defaultPrimitives;
    render(
      <Grid columns={2} flow testId="g">
        <GridCell width="number">
          <span />
        </GridCell>
      </Grid>,
    );
    expect(screen.getByTestId("g").className).toContain("items-end");
    expect(screen.getByTestId("g").firstElementChild?.className).toContain("whitespace-nowrap");
  });

  test("drawer form renders the summary box above the fields", () => {
    const { Form } = defaultPrimitives;
    render(
      <InsideDrawerProvider value>
        <Form
          onSubmit={() => {}}
          testId="drawer-form"
          summary={{ title: "Grundmiete · WE-12", subtitle: "Aktuell 850,00 €" }}
        >
          <span />
        </Form>
      </InsideDrawerProvider>,
    );
    expect(screen.getByTestId("drawer-form-summary").textContent).toContain("Grundmiete · WE-12");
  });
});

function ActionsHost(): ReactNode {
  const slot = usePageHeaderSlot();
  return <div ref={slot?.setActionsElement} data-testid="actions-host" />;
}
