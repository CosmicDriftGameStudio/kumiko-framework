// A handler must tell a deliberately typed 0 from an untouched money field, which stays out of the payload.

import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const correctForm: ActionFormScreenDefinition = {
  id: "correct",
  type: "actionForm",
  handler: "billing:write:correct",
  fields: {
    id: { type: "text", required: true } as TextFieldDef,
    note: { type: "text" } as TextFieldDef,
    total: { type: "money", required: true, currency: { kind: "literal", code: "EUR" } },
    fee: { type: "money", currency: { kind: "literal", code: "EUR" } },
  },
  layout: { sections: [{ fields: [{ field: "id", visible: false }, "note", "total", "fee"] }] },
  load: { query: "billing:query:invoice:detail" },
};

// Prefilled only through URL params (params.map), no load query: amounts have no string form,
// so a blank amount must mean "unchanged" to the handler.
const correctFromParamsForm: ActionFormScreenDefinition = {
  ...correctForm,
  id: "correct-from-params",
  load: undefined,
  // buildAppSchema derives this from the params.map of the actions that open the form.
  urlPrefillFields: ["id", "note"],
};

function renderParamsForm(searchParams: Record<string, string>): unknown[] {
  const writes: unknown[] = [];
  const dispatcher: Dispatcher = createMockDispatcher({
    write: (async (_type: string, payload: unknown) => {
      writes.push(payload);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId: "billing:screen:correct-from-params" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams,
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={{ featureName: "billing", entities: {}, screens: [correctFromParamsForm] }}
          qn="billing:screen:correct-from-params"
        />
      </NavProvider>
    </DispatcherProvider>,
  );
  return writes;
}

function renderForm(record: Record<string, unknown>): unknown[] {
  const writes: unknown[] = [];
  const dispatcher: Dispatcher = createMockDispatcher({
    query: (async () => ({ isSuccess: true, data: record })) as unknown as Dispatcher["query"],
    write: (async (_type: string, payload: unknown) => {
      writes.push(payload);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId: "billing:screen:correct" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams: {},
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={{ featureName: "billing", entities: {}, screens: [correctForm] }}
          qn="billing:screen:correct"
          entityId="i1"
        />
      </NavProvider>
    </DispatcherProvider>,
  );
  return writes;
}

function input(field: string): HTMLInputElement {
  const el = screen.getByTestId(`field-${field}`).querySelector("input");
  if (!el) throw new Error(`expected the ${field} input`);
  return el;
}

describe("actionForm money 0", () => {
  test("typing 0 over a non-zero record value submits amount 0", async () => {
    const writes = renderForm({ id: "i1", note: "n", total: { amount: 50, currency: "EUR" } });
    await waitFor(() => expect(input("note").value).toBe("n"));
    const user = userEvent.setup();
    await user.click(input("total"));
    await user.keyboard("0");
    await user.tab();
    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ total: { amount: 0, currency: "EUR" } });
  });

  test("an untouched optional money field is not sent as a deliberate 0", async () => {
    const writes = renderForm({
      id: "i1",
      note: "n",
      total: { amount: 50, currency: "EUR" },
      fee: null,
    });
    await waitFor(() => expect(input("note").value).toBe("n"));
    const user = userEvent.setup();
    await user.type(input("note"), "x");
    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect((writes[0] as Record<string, unknown>)["fee"]).toBeUndefined();
  });

  test("an untouched required money field is left out so the handler schema rejects it, never sent as 0", async () => {
    const writes = renderForm({ id: "i1", note: "n", total: null });
    await waitFor(() => expect(input("note").value).toBe("n"));
    const user = userEvent.setup();
    await user.type(input("note"), "x");
    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect((writes[0] as Record<string, unknown>)["total"]).toBeUndefined();
  });

  test("a form prefilled only through URL params leaves untouched amounts out", async () => {
    const writes = renderParamsForm({ id: "i1", note: "n" });
    await waitFor(() => expect(input("note").value).toBe("n"));
    const user = userEvent.setup();
    await user.type(input("note"), "x");
    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(writes).toHaveLength(1));
    const payload = writes[0] as Record<string, unknown>;
    expect(payload["note"]).toBe("nx");
    expect(payload["total"]).toBeUndefined();
    expect(payload["fee"]).toBeUndefined();
  });
});
