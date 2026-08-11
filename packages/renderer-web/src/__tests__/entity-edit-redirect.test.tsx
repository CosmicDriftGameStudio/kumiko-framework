// Issue #1942: entityEdit had no post-save redirect (only actionForm did) —
// RenderEdit only exposed onSubmit/onCancel, unreachable from a declarative
// screen. This exercises the real create/update submit path through
// KumikoScreen → EntityEditCreateBody/EntityEditUpdateForm, not just the
// type/boot-validator layer, proving a successful save actually calls
// nav.navigate(redirect) instead of the default "back to list", and that
// omitting redirect keeps the existing list-navigation behavior.
import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  FeatureSchema,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { NavTarget } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import { createMockDispatcher, fireEvent, render, screen, waitFor } from "./test-utils";

const productEntity: EntityDefinition = {
  fields: { name: { type: "text", required: false, searchable: false, sortable: false } },
};

function buildSchema(redirect?: string): FeatureSchema {
  const editScreen: ScreenDefinition = {
    id: "product-edit",
    type: "entityEdit",
    entity: "product",
    layout: { sections: [{ fields: ["name"] }] },
    ...(redirect !== undefined && { redirect }),
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
    screens: [editScreen, listScreen],
  } as FeatureSchema;
}

function fillNameAndSubmit(): void {
  const nameInput = screen.getByTestId("field-name").querySelector("input") as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: "Widget" } });
  const form = screen.getByTestId("render-edit-form");
  fireEvent.submit(form);
}

describe("entityEdit redirect (#1942)", () => {
  test("create: successful save with redirect set navigates there, not to the list", async () => {
    const navigated: NavTarget[] = [];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "shop:screen:product-edit" },
            navigate: (target) => navigated.push(target),
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <KumikoScreen schema={buildSchema("product-detail")} qn="shop:screen:product-edit" />
        </NavProvider>
      </DispatcherProvider>,
    );

    fillNameAndSubmit();

    await waitFor(() => expect(navigated).toEqual([{ screenId: "product-detail" }]));
  });

  test("create: no redirect set falls back to the entity's list screen", async () => {
    const navigated: NavTarget[] = [];
    render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <NavProvider
          value={{
            route: { screenId: "shop:screen:product-edit" },
            navigate: (target) => navigated.push(target),
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
            setSearchParams: () => {},
          }}
        >
          <KumikoScreen schema={buildSchema()} qn="shop:screen:product-edit" />
        </NavProvider>
      </DispatcherProvider>,
    );

    fillNameAndSubmit();

    await waitFor(() => expect(navigated).toEqual([{ screenId: "product-list" }]));
  });

  test("update: successful save with redirect set navigates there, not to the list", async () => {
    const navigated: NavTarget[] = [];
    const dispatcher = createMockDispatcher({
      query: (async () => ({
        isSuccess: true,
        data: { id: "42", version: 1, name: "Existing" },
      })) as unknown as Dispatcher["query"],
    });

    render(
      <DispatcherProvider dispatcher={dispatcher}>
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
          <KumikoScreen
            schema={buildSchema("product-detail")}
            qn="shop:screen:product-edit"
            entityId="42"
          />
        </NavProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("field-name")).toBeTruthy());
    fillNameAndSubmit();

    await waitFor(() => expect(navigated).toEqual([{ screenId: "product-detail" }]));
  });
});
