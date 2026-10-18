import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import { fireEvent } from "@testing-library/react";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const updateForm: ActionFormScreenDefinition = {
  id: "update-form",
  type: "actionForm",
  handler: "shop:write:update",
  fields: {
    type: { type: "text", required: true } as TextFieldDef,
    label: { type: "text", required: true } as TextFieldDef,
    internal: { type: "text", default: "seeded" } as TextFieldDef,
  },
  layout: { sections: [{ fields: ["type", "label"] }] },
  urlPrefillFields: ["type", "label"],
  writeExcludedFields: ["type", "internal"],
};

function renderForm(definition: ActionFormScreenDefinition, searchParams: Record<string, string>) {
  const calls: unknown[] = [];
  const dispatcher: Dispatcher = createMockDispatcher({
    write: (async (_type: string, payload: unknown) => {
      calls.push(payload);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId: "shop:screen:update-form" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams,
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={{ featureName: "shop", entities: {}, screens: [definition] }}
          qn="shop:screen:update-form"
        />
      </NavProvider>
    </DispatcherProvider>,
  );
  return calls;
}

describe("KumikoScreen / actionForm writeExcludedFields (web primitives)", () => {
  test("excluded prefilled field renders read-only and never reaches the payload", async () => {
    const calls = renderForm(updateForm, { type: "number", label: "Alt" });
    const typeInput = screen.getByDisplayValue("number") as HTMLInputElement;
    expect(typeInput.readOnly || typeInput.disabled).toBe(true);

    fireEvent.change(screen.getByDisplayValue("Alt"), { target: { value: "Neu" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(calls.length).toBe(1));
    const payload = calls[0] as Record<string, unknown>;
    expect(payload["label"]).toBe("Neu");
    expect(payload).not.toHaveProperty("type");
  });

  test("an excluded required field left empty does not block submit", async () => {
    const calls = renderForm(updateForm, { label: "Alt" });
    fireEvent.change(screen.getByDisplayValue("Alt"), { target: { value: "Neu" } });
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).not.toHaveProperty("type");
  });

  test("an excluded field outside the layout that carries a default stays out of the payload", async () => {
    const calls = renderForm(updateForm, { type: "number", label: "Alt" });
    fireEvent.change(screen.getByDisplayValue("Alt"), { target: { value: "Neu" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).not.toHaveProperty("internal");
  });
});
