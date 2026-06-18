import { describe, expect, test } from "bun:test";
import type { Dispatcher } from "@cosmicdrift/kumiko-headless";
import {
  createStaticLocaleResolver,
  DispatcherProvider,
  kumikoDefaultTranslations,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ConfirmAccountDeletionScreen } from "../confirm-deletion-screen";
import { defaultTranslations } from "../i18n";
import { RequestAccountDeletionScreen } from "../request-deletion-screen";

const resolver = createStaticLocaleResolver({ locale: "de" });

type WriteCall = { readonly type: string; readonly payload: unknown };

function makeDispatcher(ok: boolean, calls: WriteCall[]): Dispatcher {
  return {
    write: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return ok
        ? { isSuccess: true, data: {} }
        : { isSuccess: false, error: { reason: "invalid_or_expired_token", message: "nope" } };
    },
  } as unknown as Dispatcher;
}

function makeThrowingDispatcher(): Dispatcher {
  return {
    write: async () => {
      throw new Error("network down");
    },
  } as unknown as Dispatcher;
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

// SKIPPED — CI-only flake (#457): on the shared single-process happy-dom runner
// the click never reaches React's submit handler after ~30 prior DOM test files
// have mounted/unmounted (write is never invoked, calls stays empty). Green
// locally and on main; not a timing issue. Un-skip once the global afterEach
// teardown / per-file DOM isolation fix lands.
describe.skip("RequestAccountDeletionScreen", () => {
  test("Submit → write(request-deletion-by-email) + enumeration-safe Success", async () => {
    const calls: WriteCall[] = [];
    const ui = renderWith(<RequestAccountDeletionScreen />, makeDispatcher(true, calls));
    fireEvent.change(ui.getByRole("textbox"), { target: { value: "a@b.com" } });
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/Mail gesendet/)).toBeTruthy());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.type).toBe("user-data-rights:write:request-deletion-by-email");
    expect(calls[0]?.payload).toEqual({ email: "a@b.com" });
  });

  test("write-Failure → Error-Banner", async () => {
    const calls: WriteCall[] = [];
    const ui = renderWith(<RequestAccountDeletionScreen />, makeDispatcher(false, calls));
    fireEvent.change(ui.getByRole("textbox"), { target: { value: "a@b.com" } });
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/schief gegangen/)).toBeTruthy());
    expect(ui.queryByText(/Mail gesendet/)).toBeNull();
  });
});

describe.skip("ConfirmAccountDeletionScreen", () => {
  test("ohne ?token → missingToken, kein Confirm-Button", () => {
    window.history.replaceState({}, "", "/delete-account/confirm");
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(true, []));
    expect(ui.getByText(/Kein Token/)).toBeTruthy();
    expect(ui.queryByRole("button")).toBeNull();
  });

  test("mit ?token → Confirm dispatcht confirm-deletion-by-token + Success", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm?token=tok-123");
    const calls: WriteCall[] = [];
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(true, calls));
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/vorgemerkt/)).toBeTruthy());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.type).toBe("user-data-rights:write:confirm-deletion-by-token");
    expect(calls[0]?.payload).toEqual({ token: "tok-123" });
  });

  test("write-Failure → invalidToken-Banner, kein Success", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm?token=bad");
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(false, []));
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/ungültig oder abgelaufen/)).toBeTruthy());
    expect(ui.queryByText(/vorgemerkt/)).toBeNull();
  });

  test("write wirft → generischer Error-Banner, NICHT invalidToken", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm?token=tok-123");
    const ui = renderWith(<ConfirmAccountDeletionScreen />, makeThrowingDispatcher());
    fireEvent.click(ui.getByRole("button"));
    await waitFor(() => expect(ui.getByText(/schief gegangen/)).toBeTruthy());
    expect(ui.queryByText(/ungültig oder abgelaufen/)).toBeNull();
    expect(ui.queryByText(/vorgemerkt/)).toBeNull();
  });
});
