// configEdit never pre-selects an optionsQuery default: a never-set key stays
// inherited, and saving another field must not write the suggestion as an override.

import { describe, expect, mock, test } from "bun:test";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import type { FeatureSchema } from "../../index.ts";
import { DispatcherProvider, KumikoScreen } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const OPTIONS_QUERY = "catalog:query:model-options";

const screenDef: ConfigEditScreenDefinition = {
  id: "model-settings",
  type: "configEdit",
  scope: "tenant",
  configKeys: { model: "demo:config:model", label: "demo:config:label" },
  fields: {
    model: { type: "select", options: [], optionsQuery: OPTIONS_QUERY },
    label: { type: "text" },
    // @cast-boundary inline schema-author shape — FieldDefinition union too narrow
  } as ConfigEditScreenDefinition["fields"],
  layout: { sections: [{ title: "Model", fields: ["model", "label"] }] },
};

const schema: FeatureSchema = { featureName: "demo", entities: {}, screens: [screenDef] };

describe("optionsQuery default row on a configEdit screen", () => {
  test("a never-set key stays empty and saving another field writes nothing for it", async () => {
    const batchSpy = mock(async (_commands: ReadonlyArray<{ type: string; payload: unknown }>) => ({
      isSuccess: true as const,
      results: [],
    }));
    const dispatcher: Dispatcher = createMockDispatcher({
      query: (async (qn: string) => {
        if (qn === OPTIONS_QUERY) {
          return {
            isSuccess: true,
            data: {
              rows: [
                { value: "model-a", label: "Model A" },
                { value: "model-b", label: "Model B", default: true },
              ],
            },
          };
        }
        return {
          isSuccess: true,
          data: { "demo:config:label": { value: "old", scope: "tenant" } },
        };
      }) as unknown as Dispatcher["query"],
      batch: batchSpy as unknown as Dispatcher["batch"],
    });
    const user = userEvent.setup();
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="demo:screen:model-settings" />
      </DispatcherProvider>,
    );

    await waitFor(() => screen.getByTestId("render-edit-form"));
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").hasAttribute("disabled")).toBe(false),
    );
    expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).not.toContain("Model B");

    const label = document.querySelector("#kumiko-edit-label") as HTMLInputElement;
    await user.clear(label);
    await user.type(label, "new");
    await user.click(screen.getByTestId("render-edit-submit"));

    await waitFor(() => expect(batchSpy).toHaveBeenCalled());
    const commands = batchSpy.mock.calls[0]?.[0] ?? [];
    expect(commands).toEqual([
      {
        type: "config:write:set",
        payload: { key: "demo:config:label", value: "new", scope: "tenant" },
      },
    ]);
  });
});
