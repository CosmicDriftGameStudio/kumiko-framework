// Submitting before the options of a required optionsQuery select have loaded shows its
// required error; the default row seeded afterwards must clear it, like a typed value does.

import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import type { SelectFieldDef } from "@cosmicdrift/kumiko-types/fields";
import userEvent from "@testing-library/user-event";
import type { Dispatcher } from "../../headless/index.ts";
import { DispatcherProvider, KumikoScreen, NavProvider } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const OPTIONS_QUERY = "catalog:query:model-options";

const modelForm: ActionFormScreenDefinition = {
  id: "pick-model",
  type: "actionForm",
  handler: "catalog:write:pick",
  fields: {
    note: { type: "text" },
    model: {
      type: "select",
      options: [],
      required: true,
      optionsQuery: OPTIONS_QUERY,
      optionsQueryPayload: {},
    } as SelectFieldDef,
  },
  layout: { sections: [{ fields: ["note", "model"] }] },
};

describe("required optionsQuery select with a default row", () => {
  test("the seeded default clears the required error raised by an early submit", async () => {
    let releaseOptions: () => void = () => {};
    const optionsLoaded = new Promise<void>((resolve) => {
      releaseOptions = resolve;
    });
    const dispatcher: Dispatcher = createMockDispatcher({
      query: async () => {
        await optionsLoaded;
        return {
          isSuccess: true,
          data: {
            rows: [
              { value: "model-a", label: "Model A" },
              { value: "model-b", label: "Model B", default: true },
            ],
          },
        };
      },
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider
          value={{
            route: { screenId: "catalog:screen:pick-model" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams: {},
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

    const user = userEvent.setup();
    await user.type(document.getElementById("kumiko-edit-note") as HTMLElement, "x");
    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(document.getElementById("kumiko-edit-model-error")).not.toBeNull());

    releaseOptions();
    await waitFor(() =>
      expect(screen.getByTestId("combobox-kumiko-edit-model").textContent).toContain("Model B"),
    );
    expect(document.getElementById("kumiko-edit-model-error")).toBeNull();
  });
});
