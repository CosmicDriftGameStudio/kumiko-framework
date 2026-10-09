// secretMint reveal phase with a confirm step, rendered with the real web
// primitives: one screen form (scroll column + pinned footer), reveal content
// leading the code field, no card around or inside it.

import { describe, expect, test } from "bun:test";
import type {
  SecretMintScreenDefinition,
  TextFieldDef,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import type { FeatureSchema } from "@cosmicdrift/kumiko-renderer";
import { DispatcherProvider, KumikoScreen, NavProvider } from "@cosmicdrift/kumiko-renderer";
import { fireEvent } from "@testing-library/react";
import { createMockDispatcher, render, screen, waitFor } from "./test-utils.js";

const mintScreen: SecretMintScreenDefinition = {
  id: "mint-token",
  type: "secretMint",
  handler: "shop:write:token:mint",
  fields: { label: { type: "text" } as TextFieldDef },
  layout: { sections: [{ title: "Mint", fields: ["label"] }] },
  reveal: { fields: [{ field: "token", label: "Token" }] },
  confirm: {
    handler: "shop:write:token:confirm",
    fields: { code: { type: "text" } as TextFieldDef },
    layout: { sections: [{ title: "Confirm", fields: ["code"] }] },
  },
};

const schema: FeatureSchema = { featureName: "shop", entities: {}, screens: [mintScreen] };

describe("KumikoScreen / secretMint reveal phase with confirm (web primitives)", () => {
  test("renders as one screen form: the reveal sits in the form column above the code field, without any card", async () => {
    const dispatcher: Dispatcher = createMockDispatcher({
      write: (async () => ({
        isSuccess: true,
        data: { token: "kpat_secret" },
      })) as unknown as Dispatcher["write"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <KumikoScreen schema={schema} qn="shop:screen:mint-token" />
      </DispatcherProvider>,
    );

    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "My token" } });
    fireEvent.click(screen.getByTestId("render-edit-submit"));
    await waitFor(() => screen.getByTestId("kumiko-screen-secret-mint-reveal"));

    const forms = document.querySelectorAll("[data-testid=render-edit-form]");
    expect(forms.length).toBe(1);
    const scroll = screen.getByTestId("render-edit-form-scroll");
    const reveal = screen.getByTestId("kumiko-screen-secret-mint-reveal");
    const warning = screen.getByTestId("kumiko-screen-secret-mint-warning");
    const codeField = screen.getByLabelText(/code/i);
    expect(scroll.contains(reveal)).toBe(true);
    expect(scroll.contains(warning)).toBe(true);
    expect(reveal.compareDocumentPosition(codeField) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
    expect(document.querySelector("[data-slot=card]")).toBeNull();
    expect(screen.getByTestId("render-edit-submit")).toBeTruthy();
  });
});

describe("KumikoScreen / secretMint submitPrefilled (web primitives)", () => {
  const rotateScreen: SecretMintScreenDefinition = {
    id: "rotate-token",
    type: "secretMint",
    handler: "shop:write:token:rotate",
    fields: { id: { type: "text", required: true } as TextFieldDef },
    layout: { sections: [{ fields: [{ field: "id", visible: false }] }] },
    reveal: { fields: [{ field: "token", label: "Token" }] },
    urlPrefillFields: ["id"],
    submitPrefilled: true,
  };

  function renderRotate(
    definition: SecretMintScreenDefinition,
    searchParams: Record<string, string>,
  ) {
    const calls: unknown[] = [];
    const dispatcher: Dispatcher = createMockDispatcher({
      write: (async (_type: string, payload: unknown) => {
        calls.push(payload);
        return { isSuccess: true, data: { token: "kpat_rotated" } };
      }) as unknown as Dispatcher["write"],
    });
    render(
      <DispatcherProvider dispatcher={dispatcher}>
        <NavProvider
          value={{
            route: { screenId: "shop:screen:rotate-token" },
            navigate: () => {},
            replace: () => {},
            hrefFor: () => "",
            searchParams,
            setSearchParams: () => {},
          }}
        >
          <KumikoScreen
            schema={{ featureName: "shop", entities: {}, screens: [definition] }}
            qn="shop:screen:rotate-token"
          />
        </NavProvider>
      </DispatcherProvider>,
    );
    return calls;
  }

  test("hidden prefilled field: no input, submit enabled at once, payload carries the value, reveal shows", async () => {
    const calls = renderRotate(rotateScreen, { id: "abc" });
    expect(screen.queryByLabelText(/^id$/i)).toBeNull();
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => screen.getByTestId("kumiko-screen-secret-mint-reveal"));
    expect(calls).toEqual([{ id: "abc" }]);
  });

  test("without the search param the hidden required field is empty: submit stays disabled", () => {
    renderRotate(rotateScreen, {});
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("without submitPrefilled a prefilled-only form stays gated as unchanged", () => {
    renderRotate(
      { ...rotateScreen, layout: { sections: [{ fields: ["id"] }] }, submitPrefilled: false },
      { id: "abc" },
    );
    expect((screen.getByTestId("render-edit-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  test("readOnly field shows the record and submits it without edits", async () => {
    const calls = renderRotate(
      {
        ...rotateScreen,
        layout: { sections: [{ fields: [{ field: "id", readOnly: true }] }] },
      },
      { id: "abc" },
    );
    expect(screen.getByDisplayValue("abc")).toBeTruthy();
    const submit = screen.getByTestId("render-edit-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => screen.getByTestId("kumiko-screen-secret-mint-reveal"));
    expect(calls).toEqual([{ id: "abc" }]);
  });
});
