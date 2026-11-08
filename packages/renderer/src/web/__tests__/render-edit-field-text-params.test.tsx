import { describe, expect, test } from "bun:test";
import type { ActionFormScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  synthesizeActionFormEntity,
  synthesizeActionFormScreen,
} from "../../app/action-form-shim.ts";
import { resolveFieldText } from "../../headless/index.ts";
import { DispatcherProvider, RenderEdit } from "../../index.ts";
import { createMockDispatcher, fireEvent, render, screen } from "./test-utils.tsx";

const form: ActionFormScreenDefinition = {
  id: "offer",
  type: "actionForm",
  handler: "shop:write:offer",
  fields: { price: { type: "text" }, note: { type: "text" } },
  fieldLabels: { note: { key: "note.label", params: { price: "price" } } },
  fieldDescriptions: { note: { key: "note.help", params: { price: "price" } } },
  layout: { sections: [{ fields: ["price", "note"] }] },
};

const translate = (key: string, params?: Readonly<Record<string, unknown>>): string =>
  key === "note.label" ? `Note for ${String(params?.["price"])}` : key;

describe("fieldLabels and fieldDescriptions with params", () => {
  test("the label follows the form value and the description drops while it is empty", () => {
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({})}>
        <RenderEdit
          screen={synthesizeActionFormScreen(form)}
          entity={synthesizeActionFormEntity(form.fields)}
          featureName="shop"
          initial={{ price: "", note: "" }}
          translate={translate}
          fieldDescription={(fieldName, values) => {
            const ref = form.fieldDescriptions?.[fieldName];
            if (ref === undefined) return undefined;
            const { text, complete } = resolveFieldText(ref, values, translate);
            return complete ? text : undefined;
          }}
        />
      </DispatcherProvider>,
    );
    expect(screen.getByTestId("field-note").textContent).toContain("Note for ");
    expect(screen.queryByText("note.help")).toBeNull();
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: "15" } });
    expect(screen.getByTestId("field-note").textContent).toContain("Note for 15");
    expect(screen.getByText("note.help")).toBeTruthy();
  });
});
