import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import { fireEvent } from "@testing-library/react";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const archiveForm: ActionFormScreenDefinition = {
  id: "archive-form",
  type: "actionForm",
  handler: "shop:write:archive",
  fields: { id: { type: "text", required: true } as TextFieldDef },
  layout: { sections: [{ fields: [{ field: "id", visible: false }] }] },
  urlPrefillFields: ["id"],
  submitPrefilled: true,
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
          route: { screenId: "shop:screen:archive-form" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams,
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={{ featureName: "shop", entities: {}, screens: [definition] }}
          qn="shop:screen:archive-form"
        />
      </NavProvider>
    </DispatcherProvider>,
  );
  return calls;
}

describe("KumikoScreen / actionForm submitPrefilled (web primitives)", () => {
  test("hidden prefilled field: submit enabled at once and the payload carries the value", async () => {
    const calls = renderForm(archiveForm, { id: "abc" });
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(calls).toEqual([{ id: "abc" }]));
  });

  test("without the search param submit stays disabled", () => {
    renderForm(archiveForm, {});
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("without submitPrefilled a prefilled-only form stays gated as unchanged", () => {
    renderForm(
      { ...archiveForm, layout: { sections: [{ fields: ["id"] }] }, submitPrefilled: false },
      { id: "abc" },
    );
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });
});
