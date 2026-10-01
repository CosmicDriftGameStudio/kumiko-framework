// A select field with `optionsQuery` loads its options from a query handler
// instead of a static list. On a configEdit screen the stored value must stay
// visible when it is not (yet) in the result, and a pick must be written as-is:
// no client-side check against the (empty) static options.

import { describe, expect, mock, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen } from "@cosmicdrift/kumiko-renderer";
import userEvent from "@testing-library/user-event";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const OPTIONS_QUERY = "catalog:query:model-options";
const OPTIONS_PAYLOAD = { modality: "text", provider: "anthropic" } as const;

const modelScreen: ConfigEditScreenDefinition = {
  id: "model-settings",
  type: "configEdit",
  scope: "tenant",
  configKeys: { model: "demo:config:model" },
  fields: {
    model: {
      type: "select",
      options: [],
      optionsQuery: OPTIONS_QUERY,
      optionsQueryPayload: OPTIONS_PAYLOAD,
    },
    // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
  } as ConfigEditScreenDefinition["fields"],
  layout: { sections: [{ title: "Model", fields: ["model"] }] },
};

const schema: FeatureSchema = {
  featureName: "demo",
  entities: {},
  screens: [modelScreen],
};

function makeDispatcher(storedModel: string) {
  const optionCalls: unknown[] = [];
  const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
    isSuccess: true as const,
    results: [],
  }));
  const dispatcher: Dispatcher = createMockDispatcher({
    query: (async (qn: string, payload: unknown) => {
      if (qn === OPTIONS_QUERY) {
        optionCalls.push(payload);
        return {
          isSuccess: true,
          data: {
            rows: [
              { value: "model-a", label: "Model A (fast)" },
              { value: "model-b", label: "Model B (smart)" },
            ],
          },
        };
      }
      return {
        isSuccess: true,
        data: { "demo:config:model": { value: storedModel, scope: "tenant" } },
      };
    }) as unknown as Dispatcher["query"],
    batch: batchSpy as unknown as Dispatcher["batch"],
  });
  return { dispatcher, optionCalls, batchSpy };
}

describe("select optionsQuery on a configEdit screen", () => {
  test("queries with the static payload and shows the returned labels verbatim", async () => {
    const { dispatcher, optionCalls } = makeDispatcher("model-a");
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:model-settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    expect(optionCalls[0]).toEqual(OPTIONS_PAYLOAD);

    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain(
        "Model A (fast)",
      ),
    );
    await user.click(screen.getByTestId("combobox-kumiko-edit-model"));
    expect(await screen.findByText("Model B (smart)")).toBeDefined();
  });

  test("a stored value missing from the result stays visible as its raw value", async () => {
    const { dispatcher } = makeDispatcher("retired-model");
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:model-settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain(
        "retired-model",
      ),
    );
  });

  test("picking an option and saving writes exactly that value", async () => {
    const { dispatcher, batchSpy } = makeDispatcher("model-a");
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:model-settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain(
        "Model A (fast)",
      ),
    );
    await user.click(screen.getByTestId("combobox-kumiko-edit-model"));
    await user.click(await screen.findByText("Model B (smart)"));
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalled());
    const commands = batchSpy.mock.calls[0]?.[0];
    if (!commands) throw new Error("batchSpy not called");
    expect(commands).toEqual([
      {
        type: "config:write:set",
        payload: { key: "demo:config:model", value: "model-b", scope: "tenant" },
      },
    ]);
  });
});
