import { describe, expect, test } from "bun:test";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import userEvent from "@testing-library/user-event";
import { WriteOnlyTextInput } from "../../components/render-field-write-only.tsx";
import type { Dispatcher, EditFieldViewModel } from "../../headless/index.ts";
import { DispatcherProvider, RenderEdit } from "../../index.ts";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.tsx";

const entity = {
  fields: { note: { type: "text" }, title: { type: "text" } },
} as unknown as EntityDefinition;

const SCREEN: EntityEditScreenDefinition = {
  id: "demo:screen:offer-edit",
  type: "entityEdit",
  entity: "offer",
  layout: { sections: [{ title: "Offer", fields: ["title", "note"] }] },
};

describe("RenderEdit footer actions", () => {
  test("actions sit in the footer and an align: start action is set apart on the left", () => {
    render(
      <DispatcherProvider dispatcher={createMockDispatcher()}>
        <RenderEdit
          screen={SCREEN}
          entity={entity}
          featureName="demo"
          initial={{ title: "t", note: "n" }}
          writeCommand="offer:create"
          actions={[
            { id: "discard", label: "Discard", onPress: () => {}, align: "start" },
            { id: "park", label: "Park", onPress: () => {} },
          ]}
        />
      </DispatcherProvider>,
    );

    const start = screen.getByTestId("render-edit-footer-start");
    expect(start.textContent).toBe("Discard");
    // Same action row as the other custom actions, the start group leading it.
    const row = start.parentElement as HTMLElement;
    expect(row.textContent).toContain("Park");
    expect(row.firstElementChild).toBe(start);
    expect(start.className).toContain("mr-auto");
  });
});

describe("RenderEdit formErrorOnTop", () => {
  const failingWrite = (async () => ({
    isSuccess: false,
    error: { code: "boom", message: "Could not save", details: {} },
  })) as unknown as Dispatcher["write"];

  async function submitAndGetFormHtml(formErrorOnTop: boolean): Promise<string> {
    render(
      <DispatcherProvider dispatcher={createMockDispatcher({ write: failingWrite })}>
        <RenderEdit
          screen={SCREEN}
          entity={entity}
          featureName="demo"
          initial={{ title: "t", note: "n" }}
          writeCommand="offer:create"
          {...(formErrorOnTop && { formErrorOnTop: true })}
        />
      </DispatcherProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getAllByRole("textbox")[0] as HTMLElement, "x");
    await user.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => expect(screen.getByTestId("render-edit-form-error")).toBeTruthy());
    return screen.getByTestId("render-edit-form").innerHTML;
  }

  test("the banner comes before the fields when set", async () => {
    const html = await submitAndGetFormHtml(true);
    expect(html.indexOf("render-edit-form-error")).toBeLessThan(html.indexOf("field-title"));
  });

  test("the banner stays below the fields by default", async () => {
    const html = await submitAndGetFormHtml(false);
    expect(html.indexOf("render-edit-form-error")).toBeGreaterThan(html.indexOf("field-note"));
  });
});

describe("WriteOnlyTextInput", () => {
  function field(value: unknown): EditFieldViewModel {
    return {
      field: "apiKey",
      value,
      readOnly: false,
      required: false,
    } as unknown as EditFieldViewModel;
  }
  function input(value: unknown) {
    return (
      <WriteOnlyTextInput
        field={field(value)}
        id="apiKey"
        hasError={false}
        onChange={() => {}}
        changed={false}
      />
    );
  }

  test("an open Replace stays open when the record reloads with the value still set", async () => {
    const { rerender } = render(input(true));
    await userEvent.setup().click(screen.getByTestId("field-write-only-replace-apiKey"));
    expect(screen.queryByTestId("field-write-only-replace-apiKey")).toBeNull();

    rerender(input(undefined));
    rerender(input(true));

    expect(screen.queryByTestId("field-write-only-replace-apiKey")).toBeNull();
    expect(screen.queryByTestId("field-write-only-set-apiKey")).toBeNull();
  });
});
