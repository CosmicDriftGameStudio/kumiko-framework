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

describe("select optionsQuery depending on a sibling field", () => {
  const dependentScreen: ConfigEditScreenDefinition = {
    id: "dependent-settings",
    type: "configEdit",
    scope: "tenant",
    configKeys: { provider: "demo:config:provider", model: "demo:config:model" },
    fields: {
      provider: { type: "select", options: ["anthropic", "openai"], display: "dropdown" },
      model: {
        type: "select",
        options: [],
        optionsQuery: OPTIONS_QUERY,
        optionsQueryPayload: { provider: { field: "provider" }, modality: "text" },
      },
      // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
    } as ConfigEditScreenDefinition["fields"],
    layout: { sections: [{ title: "Model", fields: ["provider", "model"] }] },
  };
  const dependentSchema: FeatureSchema = {
    featureName: "demo",
    entities: {},
    screens: [dependentScreen],
  };

  function makeDependentDispatcher(stored: { provider: string; model: string }) {
    const optionCalls: Record<string, unknown>[] = [];
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string, payload: unknown) => {
        if (qn === OPTIONS_QUERY) {
          const asked = payload as Record<string, unknown>;
          optionCalls.push(asked);
          const rows =
            asked["provider"] === "openai"
              ? [
                  { value: "model-x", label: "Model X" },
                  { value: "model-a", label: "Model A (fast)" },
                ]
              : [
                  { value: "model-a", label: "Model A (fast)" },
                  { value: "model-b", label: "Model B (smart)" },
                ];
          return { isSuccess: true, data: { rows } };
        }
        return {
          isSuccess: true,
          data: {
            "demo:config:provider": { value: stored.provider, scope: "tenant" },
            "demo:config:model": { value: stored.model, scope: "tenant" },
          },
        };
      }) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });
    return { dispatcher, optionCalls, batchSpy };
  }

  async function renderDependent(stored: { provider: string; model: string }) {
    const harness = makeDependentDispatcher(stored);
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={harness.dispatcher}>
        <KumikoScreen schema={dependentSchema} qn="demo:screen:dependent-settings" />
      </DispatcherProvider>,
    );
    await waitFor(() => screen.getByTestId("render-edit-form"));
    await waitFor(() => expect(harness.optionCalls.length).toBeGreaterThan(0));
    return { ...harness, user };
  }

  async function switchProviderTo(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(screen.getByTestId("combobox-kumiko-edit-provider"));
    await user.click(await screen.findByText(label));
  }

  test("the payload carries the sibling field's current value next to literals", async () => {
    const { optionCalls } = await renderDependent({ provider: "anthropic", model: "model-a" });
    expect(optionCalls[0]).toEqual({ provider: "anthropic", modality: "text" });
  });

  test("an empty sibling value leaves its key out of the payload", async () => {
    const { optionCalls } = await renderDependent({ provider: "", model: "" });
    expect(optionCalls[0]).toEqual({ modality: "text" });
  });

  test("a first load with the stored value missing keeps the value", async () => {
    await renderDependent({ provider: "anthropic", model: "retired-model" });
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain(
        "retired-model",
      ),
    );
  });

  test("changing the sibling reloads, and a value missing from the new rows is cleared", async () => {
    const { user, optionCalls, batchSpy } = await renderDependent({
      provider: "anthropic",
      model: "model-b",
    });
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain(
        "Model B (smart)",
      ),
    );
    await switchProviderTo(user, "openai");
    await waitFor(() =>
      expect(optionCalls.at(-1)).toEqual({ provider: "openai", modality: "text" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).not.toContain("model-b"),
    );
    expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).not.toContain(
      "Model B (smart)",
    );
    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(batchSpy).toHaveBeenCalled());
    // "" must not be stored as an override: it resets the key to the inherited value.
    expect(batchSpy.mock.calls[0]?.[0]).toContainEqual({
      type: "config:write:reset",
      payload: { key: "demo:config:model", scope: "tenant" },
    });
    expect(batchSpy.mock.calls[0]?.[0]).not.toContainEqual(
      expect.objectContaining({
        type: "config:write:set",
        payload: expect.objectContaining({ key: "demo:config:model" }),
      }),
    );
  });

  test("changing the sibling keeps a value that the new rows still contain", async () => {
    const { user, optionCalls } = await renderDependent({
      provider: "anthropic",
      model: "model-a",
    });
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain(
        "Model A (fast)",
      ),
    );
    await switchProviderTo(user, "openai");
    await waitFor(() => expect(optionCalls.at(-1)?.["provider"]).toBe("openai"));
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").hasAttribute("disabled")).toBe(false),
    );
    expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain(
      "Model A (fast)",
    );
  });
});

describe("config origin line for a static-options select", () => {
  test("shows the default's option label instead of the raw value", async () => {
    const staticScreen: ConfigEditScreenDefinition = {
      id: "static-settings",
      type: "configEdit",
      scope: "tenant",
      configKeys: { mode: "demo:config:mode" },
      fields: {
        mode: { type: "select", options: ["fast-mode", "slow-mode"] },
        // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
      } as ConfigEditScreenDefinition["fields"],
      layout: { sections: [{ title: "Mode", fields: ["mode"] }] },
    };
    const staticSchema: FeatureSchema = {
      featureName: "demo",
      entities: {},
      screens: [staticScreen],
    };
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string) => {
        if (qn === "config:query:cascade") {
          return {
            isSuccess: true,
            data: {
              "demo:config:mode": {
                value: "fast-mode",
                source: "tenant-row",
                levels: [
                  {
                    source: "tenant-row",
                    label: "tenant-row",
                    value: "fast-mode",
                    isActive: true,
                    hasValue: true,
                  },
                  {
                    source: "default",
                    label: "default",
                    value: "slow-mode",
                    isActive: false,
                    hasValue: true,
                  },
                ],
              },
            },
          };
        }
        return {
          isSuccess: true,
          data: { "demo:config:mode": { value: "fast-mode", scope: "tenant" } },
        };
      }) as unknown as Dispatcher["query"],
    });
    const translate = (key: string) =>
      key.endsWith(":field:mode:option:slow-mode") ? "Slow mode" : key;
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen
          schema={staticSchema}
          qn="demo:screen:static-settings"
          translate={translate}
        />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const cascade = await waitFor(() => screen.getByTestId("config-cascade"));
    await waitFor(() => expect(cascade.textContent).toContain("Slow mode"));
    expect(cascade.textContent).not.toContain("slow-mode");
  });
});

describe("config origin line for an optionsQuery select", () => {
  test("origin line and level rows show option labels instead of stored ids", async () => {
    const user = userEvent.setup();
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string) => {
        if (qn === OPTIONS_QUERY) {
          return {
            isSuccess: true,
            data: {
              rows: [
                { value: "0b1c-uuid", label: "Model A (fast)" },
                { value: "7e2d-uuid", label: "Model B (cheap)" },
              ],
            },
          };
        }
        if (qn === "config:query:cascade") {
          return {
            isSuccess: true,
            data: {
              "demo:config:model": {
                value: "0b1c-uuid",
                source: "tenant-row",
                levels: [
                  {
                    source: "tenant-row",
                    label: "tenant-row",
                    value: "0b1c-uuid",
                    isActive: true,
                    hasValue: true,
                  },
                  {
                    source: "computed",
                    label: "computed",
                    value: undefined,
                    isActive: false,
                    hasValue: false,
                  },
                  {
                    source: "default",
                    label: "default",
                    value: "7e2d-uuid",
                    isActive: false,
                    hasValue: true,
                  },
                ],
              },
            },
          };
        }
        return {
          isSuccess: true,
          data: { "demo:config:model": { value: "0b1c-uuid", scope: "tenant" } },
        };
      }) as unknown as Dispatcher["query"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:model-settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    const cascade = await waitFor(() => screen.getByTestId("config-cascade"));
    await waitFor(() => expect(cascade.textContent).toContain("Model B (cheap)"));
    expect(cascade.textContent).not.toContain("7e2d-uuid");

    await user.click(screen.getByRole("button", { name: "Show all levels" }));
    await waitFor(() => expect(cascade.textContent).toContain("Model A (fast)"));
    expect(cascade.textContent).not.toContain("0b1c-uuid");
  });
});
