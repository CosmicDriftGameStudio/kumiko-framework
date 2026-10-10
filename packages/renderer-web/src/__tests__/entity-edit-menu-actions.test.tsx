import { describe, expect, mock, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditAction,
  FeatureSchema,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { NavTarget } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { PageHeaderSlotProvider, usePageHeaderSlot } from "../layout/page-header-slot.js";
import { createMockDispatcher, fireEvent, render, screen, waitFor, within } from "./test-utils.js";

const productEntity: EntityDefinition = {
  fields: { name: { type: "text", required: false, searchable: false, sortable: false } },
};

function buildSchema(actions: readonly EntityEditAction[]): FeatureSchema {
  const editScreen: ScreenDefinition = {
    id: "product-edit",
    type: "entityEdit",
    entity: "product",
    layout: { sections: [{ fields: ["name"] }] },
    actions,
  };
  const detailScreen: ScreenDefinition = {
    id: "product-detail",
    type: "entityEdit",
    entity: "product",
    layout: { sections: [{ fields: ["name"] }] },
  };
  const listScreen: ScreenDefinition = {
    id: "product-list",
    type: "entityList",
    entity: "product",
    columns: ["name"],
  };
  return {
    featureName: "shop",
    entities: { product: productEntity },
    screens: [editScreen, detailScreen, listScreen],
  } as FeatureSchema;
}

function ActionsHost(): ReactNode {
  const slot = usePageHeaderSlot();
  return <div ref={slot?.setActionsElement} data-testid="actions-host" />;
}

const openAction: EntityEditAction = {
  kind: "navigate",
  id: "open",
  label: "Open detail",
  screen: "product-detail",
};

const archiveAction: EntityEditAction = {
  id: "archive",
  label: "Archive product",
  handler: "shop:write:product:archive",
  confirm: "Really archive?",
};

function recordDispatcher(write?: Dispatcher["write"]) {
  return createMockDispatcher({
    query: (async () => ({
      isSuccess: true,
      data: { id: "42", version: 1, name: "Existing" },
    })) as unknown as Dispatcher["query"],
    ...(write !== undefined && { write }),
  });
}

function renderEditScreen(
  actions: readonly EntityEditAction[],
  options: { readonly withHeaderMenu: boolean; readonly dispatcher?: Dispatcher },
): NavTarget[] {
  const navigated: NavTarget[] = [];
  const body = (
    <KumikoScreen schema={buildSchema(actions)} qn="shop:screen:product-edit" entityId="42" />
  );
  render(
    <DispatcherProvider dispatcher={options.dispatcher ?? recordDispatcher()}>
      <NavProvider
        value={{
          route: { screenId: "shop:screen:product-edit", entityId: "42" },
          navigate: (target) => navigated.push(target),
          replace: () => {},
          hrefFor: () => "",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        {options.withHeaderMenu ? (
          <PageHeaderSlotProvider>
            <ActionsHost />
            {body}
          </PageHeaderSlotProvider>
        ) : (
          body
        )}
      </NavProvider>
    </DispatcherProvider>,
  );
  return navigated;
}

async function openHeaderMenu(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByTestId("render-edit-header-menu")).toBeTruthy());
  fireEvent.pointerDown(screen.getByTestId("render-edit-header-menu"), { button: 0 });
  fireEvent.click(screen.getByTestId("render-edit-header-menu"));
  return screen.findByRole("menu");
}

describe("entityEdit actions with placement: menu", () => {
  test("a menu action sits in the header menu, not the footer, and selecting it navigates", async () => {
    const navigated = renderEditScreen([{ ...openAction, placement: "menu" }], {
      withHeaderMenu: true,
    });

    const menu = await openHeaderMenu();
    expect(screen.queryByTestId("render-edit-action-open")).toBeNull();
    fireEvent.click(within(menu).getByText("Open detail"));

    await waitFor(() =>
      expect(navigated).toEqual([{ screenId: "product-detail", entityId: "42" }]),
    );
  });

  test("a confirm-gated menu action writes only after the dialog is confirmed", async () => {
    const write = mock(async () => ({ isSuccess: true, data: {} }));
    renderEditScreen([{ ...archiveAction, placement: "menu" }], {
      withHeaderMenu: true,
      dispatcher: recordDispatcher(write as unknown as Dispatcher["write"]),
    });

    const menu = await openHeaderMenu();
    fireEvent.click(within(menu).getByText("Archive product"));

    const dialog = await screen.findByTestId("render-edit-action-archive-dialog");
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Archive product" }));

    await waitFor(() =>
      expect(write).toHaveBeenCalledWith("shop:write:product:archive", expect.anything()),
    );
  });

  test("an action without placement stays in the footer", async () => {
    renderEditScreen([openAction], { withHeaderMenu: true });

    await waitFor(() => expect(screen.getByTestId("render-edit-action-open")).toBeTruthy());
  });

  test("without a header menu a menu action falls back to a footer button", async () => {
    renderEditScreen([{ ...openAction, placement: "menu" }], { withHeaderMenu: false });

    await waitFor(() => expect(screen.getByTestId("render-edit-action-open")).toBeTruthy());
  });
});
