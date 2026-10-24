// A row with `default: true` in an optionsQuery result is pre-selected while the
// field is empty; a set value is never replaced.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { SelectFieldDef } from "@cosmicdrift/kumiko-types/fields";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { hasUnsavedInput } from "../../leave-guard.ts";
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
  },
  layout: { sections: [{ fields: ["provider", "model"] }] },
  urlPrefillFields: ["provider", "model"],
  submitPrefilled: true,
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
  await user.click(screen.getByTestId("render-edit-submit"));
}

describe("select optionsQuery default row in an actionForm", () => {
  test("the suggestion (not the first row) is seeded and submitted without touching the form", async () => {
    const { writes, user } = renderForm({ provider: "openai" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model Y"));
    await submit(user);
    await waitFor(() => expect(writes).toEqual([{ provider: "openai", model: "model-y" }]));
  });

  test("the seeded suggestion is no unsaved input", async () => {
    renderForm({ provider: "openai" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model Y"));
    expect(hasUnsavedInput()).toBe(false);
  });

  test("with several default rows the first one wins", async () => {
    renderForm({ provider: "anthropic" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model B"));
    expect(modelCombobox().textContent).not.toContain("Model C");
  });

  test("without a default row the field stays empty", async () => {
    renderForm({ provider: "plain" });
    await waitFor(() => expect(modelCombobox().hasAttribute("disabled")).toBe(false));
    expect(modelCombobox().textContent).not.toContain("Model P");
    expect(modelCombobox().textContent).not.toContain("Model Q");
  });

  test("an already set value is not overwritten", async () => {
    const { writes, user } = renderForm({ provider: "anthropic", model: "model-a" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model A"));
    await waitFor(() => expect(modelCombobox().hasAttribute("disabled")).toBe(false));
    expect(modelCombobox().textContent).not.toContain("Model B");
    await submit(user);
    await waitFor(() => expect(writes).toEqual([{ provider: "anthropic", model: "model-a" }]));
  });

  test("a value dropped by a payload change is replaced by the new default and submitted", async () => {
    const { writes, user } = renderForm({ provider: "anthropic", model: "model-a" });
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model A"));
    await user.click(screen.getByTestId("segmented-kumiko-edit-provider-openai"));
    await waitFor(() => expect(modelCombobox().textContent).toContain("Model Y"));
    await submit(user);
    await waitFor(() => expect(writes).toEqual([{ provider: "openai", model: "model-y" }]));
  });
});
