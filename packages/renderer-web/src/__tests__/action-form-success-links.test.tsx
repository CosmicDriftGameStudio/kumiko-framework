import { describe, expect, mock, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const CREATE_PAIR = {
  id: "create-pair",
  type: "actionForm",
  handler: "demo:write:create-pair",
  fields: {
    name: { type: "text", required: true },
    note: { type: "text" },
  },
  layout: { sections: [{ fields: ["name", "note"] }] },
  successLinks: [
    { screen: "customer-edit", idFrom: "customerId", label: "demo.link.customer" },
    { screen: "order-edit", idFrom: "orderId", label: "demo.link.order" },
    { screen: "pair-list", label: "demo.link.list" },
  ],
} as unknown as ActionFormScreenDefinition;

const SCHEMA: FeatureSchema = {
  featureName: "demo",
  entities: {},
  screens: [
    CREATE_PAIR,
    { id: "customer-edit", type: "entityEdit", entity: "customer" },
    { id: "order-edit", type: "entityEdit", entity: "order" },
    { id: "pair-list", type: "entityList", entity: "customer" },
  ] as unknown as FeatureSchema["screens"],
};

const LABELS: Readonly<Record<string, string>> = {
  "demo.link.customer": "Open customer",
  "demo.link.order": "Open order",
  "demo.link.list": "Back to list",
  "demo.name.hint": "Full name",
  "demo.saved": "Pair created",
};

type WriteResult =
  | { readonly isSuccess: true; readonly data: Record<string, unknown> }
  | { readonly isSuccess: false };

function dispatcherReturning(result: WriteResult): Dispatcher {
  return createMockDispatcher({
    write: (async () =>
      result.isSuccess
        ? result
        : {
            isSuccess: false,
            error: { code: "handler_failed", message: "Handler said no", details: {} },
          }) as unknown as Dispatcher["write"],
  });
}

function renderScreen(
  screenDefinition: ActionFormScreenDefinition,
  result: WriteResult,
  navigate: (...args: unknown[]) => void = () => {},
) {
  const schema: FeatureSchema = {
    ...SCHEMA,
    screens: [screenDefinition, ...SCHEMA.screens.slice(1)],
  };
  return render(
    <DispatcherProvider dispatcher={dispatcherReturning(result)}>
      <NavProvider
        value={{
          route: { screenId: "demo:screen:create-pair" },
          navigate,
          replace: () => {},
          hrefFor: () => "#",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={schema}
          qn="demo:screen:create-pair"
          translate={(key) => LABELS[key] ?? key}
        />
      </NavProvider>
    </DispatcherProvider>,
  );
}

function nameInput(): HTMLInputElement {
  const input = screen.getByTestId("field-name").querySelector("input");
  if (!input) throw new Error("expected a name input");
  return input;
}

async function typeNameAndSubmit(): Promise<void> {
  const user = userEvent.setup();
  await user.type(nameInput(), "Ada");
  await user.click(screen.getByTestId("render-edit-submit"));
}

describe("actionForm successLinks", () => {
  test("shows the default text and one link per target after a successful submit", async () => {
    renderScreen(CREATE_PAIR, {
      isSuccess: true,
      data: { customerId: "c-1", orderId: "o-1" },
    });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await typeNameAndSubmit();

    await waitFor(() => expect(screen.getByTestId("action-form-success")).toBeTruthy());
    const box = screen.getByTestId("action-form-success");
    expect(box.textContent).toContain("kumiko.actionForm.success");
    expect(screen.getByTestId("action-form-success-link-0").textContent).toBe("Open customer");
    expect(screen.getByTestId("action-form-success-link-1").textContent).toBe("Open order");
    expect(screen.getByTestId("action-form-success-link-2").textContent).toBe("Back to list");
  });

  test("a link click navigates to the target screen with the id from the payload", async () => {
    const navigate = mock(() => {});
    renderScreen(
      CREATE_PAIR,
      { isSuccess: true, data: { customerId: "c-1", orderId: "o-1" } },
      navigate,
    );
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    await typeNameAndSubmit();
    await waitFor(() => expect(screen.getByTestId("action-form-success-link-1")).toBeTruthy());

    await userEvent.setup().click(screen.getByTestId("action-form-success-link-1"));

    expect(navigate).toHaveBeenCalledWith({ screenId: "order-edit", entityId: "o-1" }, undefined);
  });

  test("a link to a list screen without idFrom is shown and navigates without an id", async () => {
    const navigate = mock(() => {});
    renderScreen(CREATE_PAIR, { isSuccess: true, data: {} }, navigate);
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    await typeNameAndSubmit();
    await waitFor(() => expect(screen.getByTestId("action-form-success-link-2")).toBeTruthy());

    await userEvent.setup().click(screen.getByTestId("action-form-success-link-2"));

    expect(navigate).toHaveBeenCalledWith({ screenId: "pair-list" }, undefined);
  });

  test("hides a link to a record screen when the payload carries no string id", async () => {
    renderScreen(CREATE_PAIR, { isSuccess: true, data: { customerId: "c-1" } });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await typeNameAndSubmit();

    await waitFor(() => expect(screen.getByTestId("action-form-success-link-0")).toBeTruthy());
    expect(screen.queryByTestId("action-form-success-link-1")).toBeNull();
    expect(screen.getByTestId("action-form-success-link-2")).toBeTruthy();
  });

  test("uses successMessage as the box text when declared", async () => {
    renderScreen({ ...CREATE_PAIR, successMessage: "demo.saved" } as ActionFormScreenDefinition, {
      isSuccess: true,
      data: { customerId: "c-1", orderId: "o-1" },
    });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await typeNameAndSubmit();

    await waitFor(() =>
      expect(screen.getByTestId("action-form-success").textContent).toContain("Pair created"),
    );
  });

  test("the box disappears with the next edit", async () => {
    renderScreen(CREATE_PAIR, {
      isSuccess: true,
      data: { customerId: "c-1", orderId: "o-1" },
    });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());
    await typeNameAndSubmit();
    await waitFor(() => expect(screen.getByTestId("action-form-success")).toBeTruthy());

    await userEvent.setup().type(nameInput(), "x");

    await waitFor(() => expect(screen.queryByTestId("action-form-success")).toBeNull());
  });

  test("a rejected submit shows the handler error, keeps the values and no box", async () => {
    renderScreen({ ...CREATE_PAIR, resetOnSuccess: true } as ActionFormScreenDefinition, {
      isSuccess: false,
    });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await typeNameAndSubmit();

    await waitFor(() => expect(screen.getByTestId("render-edit-form-error")).toBeTruthy());
    expect(nameInput().value).toBe("Ada");
    expect(screen.queryByTestId("action-form-success")).toBeNull();
  });
});

describe("actionForm resetOnSuccess", () => {
  const RESETTING = {
    ...CREATE_PAIR,
    successLinks: undefined,
    resetOnSuccess: true,
  } as unknown as ActionFormScreenDefinition;

  test("clears the typed values after a successful submit and keeps the success box", async () => {
    renderScreen(RESETTING, { isSuccess: true, data: {} });
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await typeNameAndSubmit();

    await waitFor(() => expect(screen.getByTestId("action-form-success")).toBeTruthy());
    expect(nameInput().value).toBe("");
  });

  test("keeps the typed values when resetOnSuccess is off", async () => {
    renderScreen(
      {
        ...RESETTING,
        resetOnSuccess: undefined,
        successMessage: "demo.saved",
      } as ActionFormScreenDefinition,
      { isSuccess: true, data: {} },
    );
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    await typeNameAndSubmit();

    await waitFor(() => expect(screen.getByTestId("action-form-success")).toBeTruthy());
    expect(nameInput().value).toBe("Ada");
  });
});

describe("field placeholder", () => {
  test("is translated and set on a single-line text input", async () => {
    renderScreen(
      {
        ...CREATE_PAIR,
        fields: {
          name: { type: "text", required: true },
          note: { type: "text" },
        },
        layout: {
          sections: [{ fields: [{ field: "name", placeholder: "demo.name.hint" }, "note"] }],
        },
      } as unknown as ActionFormScreenDefinition,
      { isSuccess: true, data: {} },
    );
    await waitFor(() => expect(screen.getByTestId("render-edit-form")).toBeTruthy());

    expect(nameInput().getAttribute("placeholder")).toBe("Full name");
    const noteInput = screen.getByTestId("field-note").querySelector("input");
    expect(noteInput?.hasAttribute("placeholder")).toBe(false);
  });
});
