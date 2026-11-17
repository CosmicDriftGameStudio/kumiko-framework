import { describe, expect, test } from "bun:test";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import type { Dispatcher } from "@cosmicdrift/kumiko-renderer/headless";
import { createMockDispatcher } from "@cosmicdrift/kumiko-renderer/testing";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { CancelAccountDeletionScreen } from "../cancel-deletion-screen.tsx";
import { ConfirmAccountDeletionScreen } from "../confirm-deletion-screen.tsx";
import { defaultTranslations } from "../default-translations.ts";
import { RequestAccountDeletionScreen } from "../request-deletion-screen.tsx";

const resolver = createStaticLocaleResolver({ locale: "en" });

type WriteCall = { readonly type: string; readonly payload: unknown };

function makeDispatcher(ok: boolean, calls: WriteCall[]): Dispatcher {
  return createMockDispatcher({
    write: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return ok
        ? { isSuccess: true, data: {} }
        : {
            isSuccess: false,
            error: {
              code: "unprocessable",
              httpStatus: 422,
              i18nKey: "errors.unprocessable",
              message: "nope",
              details: { reason: "invalid_or_expired_token" },
            },
          };
    },
  });
}

function makeThrowingDispatcher(): Dispatcher {
  return createMockDispatcher({
    write: async () => {
      throw new Error("network down");
    },
  });
}

function renderWith(ui: ReactElement, dispatcher: Dispatcher): ReturnType<typeof within> {
  const { container } = render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={resolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>{ui}</DispatcherProvider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
  return within(container);
}

// CI runs this file in its own `bun test` process (own ci.yml step), NOT in the
// shared `kumiko check` run — see bunfig.ci.toml pathIgnorePatterns. The shared
// single-process happy-dom corrupts React event delegation after ~30 prior DOM
// test files mount/unmount, so the click never reached the submit handler. A fresh
// process has no such accumulation.
describe("RequestAccountDeletionScreen", () => {
  test("Submit → write(request-deletion-by-email) + enumeration-safe Success", async () => {
    const calls: WriteCall[] = [];
    const ui = renderWith(<RequestAccountDeletionScreen />, makeDispatcher(true, calls));
    fireEvent.change(ui.getByRole("textbox"), { target: { value: "a@b.com" } });
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/Email sent/)).toBeTruthy());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.type).toBe("user-data-rights:write:request-deletion-by-email");
    expect(calls[0]?.payload).toEqual({ email: "a@b.com" });
  });

  test("write-Failure → Error-Banner", async () => {
    const calls: WriteCall[] = [];
    const ui = renderWith(<RequestAccountDeletionScreen />, makeDispatcher(false, calls));
    fireEvent.change(ui.getByRole("textbox"), { target: { value: "a@b.com" } });
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/went wrong/)).toBeTruthy());
    expect(ui.queryByText(/Email sent/)).toBeNull();
  });
});

describe("ConfirmAccountDeletionScreen", () => {
  test("without #token → missingToken, no Confirm button", () => {
    window.history.replaceState({}, "", "/delete-account/confirm");
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(true, []));
    expect(ui.getByText(/No token/)).toBeTruthy();
    expect(ui.queryByRole("button")).toBeNull();
  });

  test("with #token → Confirm dispatches confirm-deletion-by-token + Success", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm#token=tok-123");
    const calls: WriteCall[] = [];
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(true, calls));
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/Deletion scheduled/)).toBeTruthy());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.type).toBe("user-data-rights:write:confirm-deletion-by-token");
    expect(calls[0]?.payload).toEqual({ token: "tok-123" });
  });

  test("write-Failure → invalidToken-Banner, no Success", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm#token=bad");
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(false, []));
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/invalid or expired/)).toBeTruthy());
    expect(ui.queryByText(/Deletion scheduled/)).toBeNull();
  });

  test("write throws → generic Error-Banner, NOT invalidToken", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm#token=tok-123");
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeThrowingDispatcher());
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/went wrong/)).toBeTruthy());
    expect(ui.queryByText(/invalid or expired/)).toBeNull();
    expect(ui.queryByText(/Deletion scheduled/)).toBeNull();
  });
});

describe("CancelAccountDeletionScreen", () => {
  test("without #token → missingToken, no Cancel button", () => {
    window.history.replaceState({}, "", "/delete-account/cancel");
    const ui = renderWith(<CancelAccountDeletionScreen />, makeDispatcher(true, []));
    expect(ui.getByText(/No token/)).toBeTruthy();
    expect(ui.queryByRole("button")).toBeNull();
  });

  test("with #token → Cancel dispatches cancel-deletion-by-token + Success", async () => {
    window.history.replaceState({}, "", "/delete-account/cancel#token=tok-456");
    const calls: WriteCall[] = [];
    const ui = renderWith(<CancelAccountDeletionScreen />, makeDispatcher(true, calls));
    fireEvent.click(ui.getByRole("button", { name: "Cancel deletion" }));
    await waitFor(() => expect(ui.getByText("Deletion cancelled")).toBeTruthy());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.type).toBe("user-data-rights:write:cancel-deletion-by-token");
    expect(calls[0]?.payload).toEqual({ token: "tok-456" });
  });

  test("write-Failure → invalidToken-Banner, no Success", async () => {
    window.history.replaceState({}, "", "/delete-account/cancel#token=bad");
    const ui = renderWith(<CancelAccountDeletionScreen />, makeDispatcher(false, []));
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/invalid or expired/)).toBeTruthy());
    expect(ui.queryByText("Deletion cancelled")).toBeNull();
  });

  test("write throws → generic Error-Banner, NOT invalidToken", async () => {
    window.history.replaceState({}, "", "/delete-account/cancel#token=tok-456");
    const ui = renderWith(<CancelAccountDeletionScreen />, makeThrowingDispatcher());
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/went wrong/)).toBeTruthy());
    expect(ui.queryByText(/invalid or expired/)).toBeNull();
  });
});
