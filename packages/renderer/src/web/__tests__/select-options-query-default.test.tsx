// A row with `default: true` in an optionsQuery result is pre-selected while the
// field is empty; a set value is never replaced.

import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { SelectFieldDef } from "@cosmicdrift/kumiko-types/fields";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const OPTIONS_QUERY = "catalog:query:model-options";

type Row = { value: string; label: string; default?: boolean };

const ROWS_BY_PROVIDER: Record<string, readonly Row[]> = {
  anthropic: [
    { value: "model-a", label: "Model A" },
    { value: "model-b", label: "Model B", default: true },
    { value: "model-c", label: "Model C", default: true },
  ],
  openai: [
    { value: "model-x", label: "Model X" },
    { value: "model-y", label: "Model Y", default: true },
  ],
  plain: [
    { value: "model-p", label: "Model P" },
    { value: "model-q", label: "Model Q" },
  ],
};

const modelForm: ActionFormScreenDefinition = {
  id: "pick-model",
  type: "actionForm",
  handler: "catalog:write:pick",
  fields: {
    provider: { type: "select", options: ["anthropic", "openai", "plain"] } as SelectFieldDef,
    model: {
      type: "select",
      options: [],
      optionsQuery: OPTIONS_QUERY,
      optionsQueryPayload: { provider: { field: "provider" } },
    } as SelectFieldDef,
    note: { type: "text" } as TextFieldDef,
  },
  layout: { sections: [{ fields: ["provider", "model", "note"] }] },
  urlPrefillFields: ["provider", "model"],
};

function renderForm(searchParams: Record<string, string>) {
  const writes: unknown[] = [];
  const dispatcher: Dispatcher = createMockDispatcher({
    query: (async (_qn: string, payload: unknown) => {
      const provider = (payload as { provider?: string }).provider ?? "";
      return { isSuccess: true, data: { rows: ROWS_BY_PROVIDER[provider] ?? [] } };
    }) as unknown as Dispatcher["query"],
    write: (async (_type: string, payload: unknown) => {
      writes.push(payload);
      return { isSuccess: true, data: {} };
    }) as unknown as Dispatcher["write"],
  });
  render(
    <DispatcherProvider dispatcher={dispatcher}>
      <NavProvider
        value={{
          route: { screenId: "catalog:screen:pick-model" },
          navigate: () => {},
          replace: () => {},
          hrefFor: () => "",
          searchParams,
          setSearchParams: () => {},
        }}
      >
        <KumikoScreen
          schema={{ featureName: "catalog", entities: {}, screens: [modelForm] }}
          qn="catalog:screen:pick-model"
        />
      </NavProvider>
    </DispatcherProvider>,
  );
  return { writes, user: userEvent.setup() };
}

const modelCombobox = () => screen.getByTestId("combobox-kumiko-edit-model");

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(document.querySelector("#kumiko-edit-note") as HTMLInputElement, "x");
  await user.click(screen.getByTestId("render-edit-submit"));
}

describe("select optionsQuery default row", () => {
  test("a default row that is not first is pre-selected and submitted", async () => {
    const { writes, user } = renderForm({ provider: "openai" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model Y"));
    await submit(user);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ provider: "openai", model: "model-y" });
  });

  test("with several default rows the first one wins", async () => {
    const { writes, user } = renderForm({ provider: "anthropic" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model B"));
    await submit(user);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ model: "model-b" });
  });

  test("without a default row the field stays empty", async () => {
    const { writes, user } = renderForm({ provider: "plain" });
    await waitFor(() => expect(modelCombobox().hasAttribute("disabled")).toBe(false));
    expect(modelCombobox().textContent).not.toContain("Model P");
    expect(modelCombobox().textContent).not.toContain("Model Q");
    await submit(user);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).not.toHaveProperty("model", expect.stringMatching(/./));
  });

  test("an already set value is not overwritten", async () => {
    const { writes, user } = renderForm({ provider: "anthropic", model: "model-a" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model A"));
    await waitFor(() => expect(modelCombobox().hasAttribute("disabled")).toBe(false));
    expect(modelCombobox().textContent).not.toContain("Model B");
    await submit(user);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ model: "model-a" });
  });

  test("a value dropped by a payload change is replaced by the new default", async () => {
    const { writes, user } = renderForm({ provider: "anthropic", model: "model-a" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model A"));
    await user.click(screen.getByTestId("segmented-kumiko-edit-provider-openai"));
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model Y"));
    await submit(user);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ provider: "openai", model: "model-y" });
  });
});
