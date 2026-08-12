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
import userEvent from "@testing-library/user-event";
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

  test("create: redirect as fully-qualified cross-feature QN navigates via its short id (#1946)", async () => {
    // redirect may name a screen in ANOTHER feature via `<feature>:screen:<id>`
    // (boot-validator accepts the QN directly) — the renderer must strip it
    // down to the short id before calling nav.navigate, since the runtime
    // router resolves bare short ids app-wide, not raw QNs (see nav.tsx).
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
          <KumikoScreen
            schema={buildSchema("statements:screen:statement-upload-list")}
            qn="shop:screen:product-edit"
          />
        </NavProvider>
      </DispatcherProvider>,
    );

    fillNameAndSubmit();

    await waitFor(() => expect(navigated).toEqual([{ screenId: "statement-upload-list" }]));
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

  test("update: redirect as fully-qualified cross-feature QN navigates via its short id (#1946)", async () => {
    // Mirrors the create-mode QN test above — EntityEditUpdateForm's
    // handleSubmitted has its own lastSegment(screen.redirect) call
    // (kumiko-screen.tsx), separate from the create path's.
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
            schema={buildSchema("statements:screen:statement-upload-list")}
            qn="shop:screen:product-edit"
            entityId="42"
          />
        </NavProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("field-name")).toBeTruthy());
    fillNameAndSubmit();

    await waitFor(() => expect(navigated).toEqual([{ screenId: "statement-upload-list" }]));
  });

  test("update: no redirect set falls back to the entity's list screen", async () => {
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
          <KumikoScreen schema={buildSchema()} qn="shop:screen:product-edit" entityId="42" />
        </NavProvider>
      </DispatcherProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("field-name")).toBeTruthy());
    fillNameAndSubmit();

    await waitFor(() => expect(navigated).toEqual([{ screenId: "product-list" }]));
  });

  test("update: delete navigates to the list even with redirect set", async () => {
    const user = userEvent.setup();
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
    // userEvent instead of fireEvent: the Radix dialog fires async state updates.
    await user.click(screen.getByTestId("render-edit-delete"));
    await user.click(screen.getByTestId("render-edit-delete-dialog-confirm"));

    await waitFor(() => expect(navigated).toEqual([{ screenId: "product-list" }]));
  });
});
