// actionForm `load`: the initial values come from a query keyed by the record id;
// no URL search param reaches the form.

import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const renameForm: ActionFormScreenDefinition = {
  id: "rename-form",
  type: "actionForm",
  handler: "shop:write:rename",
  fields: {
    id: { type: "text", required: true } as TextFieldDef,
    name: { type: "text", required: true } as TextFieldDef,
  },
  layout: { sections: [{ fields: [{ field: "id", visible: false }, "name"] }] },
  load: { query: "shop:query:product:detail" },
  urlPrefillFields: ["name"],
};

type QueryOutcome =
  | { readonly kind: "record"; readonly record: Record<string, unknown> }
  | { readonly kind: "none" }
  | { readonly kind: "error" };

type Calls = {
  readonly queries: Array<{ readonly type: string; readonly payload: unknown }>;
  readonly writes: unknown[];
};

function renderForm(options: {
  readonly definition?: ActionFormScreenDefinition;
  readonly entityId?: string;
  readonly searchParams?: Record<string, string>;
  readonly outcome: QueryOutcome;
}): Calls {
  const calls: Calls = { queries: [], writes: [] };
  const dispatcher: Dispatcher = createMockDispatcher({
    query: (async (type: string, payload: unknown) => {
      calls.queries.push({ type, payload });
      if (options.outcome.kind === "error") {
        return {
          isSuccess: false,
          error: { code: "handler_failed", message: "Detail failed", details: {} },
        };
      }
      return {
        isSuccess: true,
        data: options.outcome.kind === "record" ? options.outcome.record : null,
      };
    }) as unknown as Dispatcher["query"],
    write: (async (_type: string, payload: unknown) => {
      calls.writes.push(payload);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId: "shop:screen:rename-form" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams: options.searchParams ?? {},
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={{
            featureName: "shop",
            entities: {},
            screens: [options.definition ?? renameForm],
          }}
          qn="shop:screen:rename-form"
          {...(options.entityId !== undefined && { entityId: options.entityId })}
        />
      </NavProvider>
    </DispatcherProvider>,
  );
  return calls;
}

function nameInput(): HTMLInputElement {
  const input = screen.getByTestId("field-name").querySelector("input");
  if (!input) throw new Error("expected the name input");
  return input;
}

describe("actionForm load", () => {
  test("queries with the route id and seeds the form from the record", async () => {
    const calls = renderForm({
      entityId: "p1",
      outcome: { kind: "record", record: { id: "p1", name: "Pen", unrelated: "x" } },
    });

    await waitFor(() => expect(nameInput().value).toBe("Pen"));
    expect(calls.queries[0]).toEqual({ type: "shop:query:product:detail", payload: { id: "p1" } });
  });

  test("idParam renames the payload key", async () => {
    const calls = renderForm({
      definition: {
        ...renameForm,
        load: { query: "shop:query:product:detail", idParam: "productId" },
      },
      entityId: "p1",
      outcome: { kind: "record", record: { id: "p1", name: "Pen" } },
    });

    await waitFor(() => expect(nameInput().value).toBe("Pen"));
    expect(calls.queries[0]?.payload).toEqual({ productId: "p1" });
  });

  test("a URL search param never seeds a field, even a urlPrefillFields one", async () => {
    renderForm({
      entityId: "p1",
      searchParams: { name: "Injected", id: "other" },
      outcome: { kind: "record", record: { id: "p1", name: "Pen" } },
    });

    await waitFor(() => expect(nameInput().value).toBe("Pen"));
  });

  test("the route id wins over a URL id param", async () => {
    const calls = renderForm({
      entityId: "p1",
      searchParams: { id: "other" },
      outcome: { kind: "record", record: { id: "p1", name: "Pen" } },
    });

    await waitFor(() => expect(nameInput().value).toBe("Pen"));
    expect(calls.queries[0]?.payload).toEqual({ id: "p1" });
  });

  test("an unchanged loaded form stays disabled; an edit submits the loaded values", async () => {
    const calls = renderForm({
      entityId: "p1",
      outcome: { kind: "record", record: { id: "p1", name: "Pen" } },
    });
    await waitFor(() => expect(nameInput().value).toBe("Pen"));
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await userEvent.setup().type(nameInput(), "cil");
    await userEvent.setup().click(submit);

    await waitFor(() => expect(calls.writes).toEqual([{ id: "p1", name: "Pencil" }]));
  });

  test("with submitPrefilled the loaded values make an unchanged form submittable", async () => {
    const calls = renderForm({
      definition: { ...renameForm, submitPrefilled: true },
      entityId: "p1",
      outcome: { kind: "record", record: { id: "p1", name: "Pen" } },
    });
    await waitFor(() => expect(nameInput().value).toBe("Pen"));
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    await userEvent.setup().click(submit);

    await waitFor(() => expect(calls.writes).toEqual([{ id: "p1", name: "Pen" }]));
  });

  test("without a record id it shows a hint and runs no query", () => {
    const calls = renderForm({ outcome: { kind: "none" } });

    expect(screen.getByTestId("kumiko-screen-action-form-missing-id")).toBeTruthy();
    expect(calls.queries).toHaveLength(0);
  });

  test("a failed load query shows the error instead of the form", async () => {
    renderForm({ entityId: "p1", outcome: { kind: "error" } });

    await waitFor(() => expect(screen.getByTestId("kumiko-screen-error")).toBeTruthy());
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });

  test("an unknown record shows the not-found state instead of the form", async () => {
    renderForm({ entityId: "gone", outcome: { kind: "none" } });

    await waitFor(() => expect(screen.getByTestId("kumiko-screen-record-missing")).toBeTruthy());
    expect(screen.queryByTestId("render-edit-form")).toBeNull();
  });

  test("singleton loads the tenant row without a record id and saves the edit", async () => {
    const calls = renderForm({
      definition: {
        id: "rename-form",
        type: "actionForm",
        handler: "shop:write:rename",
        fields: { name: { type: "text", required: true } as TextFieldDef },
        layout: { sections: [{ fields: ["name"] }] },
        load: { query: "shop:query:shop-settings:detail", singleton: true },
      },
      outcome: { kind: "record", record: { id: "t1", name: "Kaffeerösterei Berger" } },
    });

    await waitFor(() => expect(nameInput().value).toBe("Kaffeerösterei Berger"));
    expect(calls.queries[0]).toEqual({ type: "shop:query:shop-settings:detail", payload: {} });
    expect(screen.queryByTestId("kumiko-screen-action-form-missing-id")).toBeNull();

    await userEvent.setup().type(nameInput(), " GmbH");
    await userEvent.setup().click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(calls.writes).toEqual([{ name: "Kaffeerösterei Berger GmbH" }]));
  });

  test("singleton never forwards a stray route id to the query", async () => {
    const calls = renderForm({
      definition: {
        ...renameForm,
        load: { query: "shop:query:shop-settings:detail", singleton: true },
      },
      entityId: "spoofed",
      outcome: { kind: "record", record: { name: "Pen" } },
    });

    await waitFor(() => expect(nameInput().value).toBe("Pen"));
    expect(calls.queries[0]?.payload).toEqual({});
  });
});
