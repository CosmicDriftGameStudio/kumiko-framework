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
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ConfirmAccountDeletionScreen } from "../confirm-deletion-screen";
import { defaultTranslations } from "../i18n";
import { RequestAccountDeletionScreen } from "../request-deletion-screen";

const resolver = createStaticLocaleResolver({ locale: "de" });

type WriteCall = { readonly type: string; readonly payload: unknown };

function makeDispatcher(ok: boolean, calls: WriteCall[]): Dispatcher {
  // test-stub: die Screens rufen ausschließlich dispatcher.write — der Rest
  // des Dispatcher-Contracts wird hier nicht gebraucht.
  return {
    write: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return ok
        ? { isSuccess: true, data: {} }
        : { isSuccess: false, error: { reason: "invalid_or_expired_token", message: "nope" } };
    },
  } as unknown as Dispatcher;
}

function renderWith(ui: ReactElement, dispatcher: Dispatcher): void {
  render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={resolver}
        fallbackBundles={[defaultTranslations, kumikoDefaultTranslations]}
      >
        <DispatcherProvider dispatcher={dispatcher}>{ui}</DispatcherProvider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
}

describe("RequestAccountDeletionScreen", () => {
  test("Submit → write(request-deletion-by-email) + enumeration-safe Success", async () => {
    const calls: WriteCall[] = [];
    renderWith(<RequestAccountDeletionScreen />, makeDispatcher(true, calls));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/Mail gesendet/)).toBeTruthy());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("user-data-rights:write:request-deletion-by-email");
    expect(calls[0]?.payload).toEqual({ email: "a@b.com" });
  });

  test("write-Failure → Error-Banner", async () => {
    const calls: WriteCall[] = [];
    renderWith(<RequestAccountDeletionScreen />, makeDispatcher(false, calls));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "a@b.com" } });
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/schief gegangen/)).toBeTruthy());
    expect(screen.queryByText(/Mail gesendet/)).toBeNull();
  });
});

describe("ConfirmAccountDeletionScreen", () => {
  test("ohne ?token → missingToken, kein Confirm-Button", () => {
    window.history.replaceState({}, "", "/delete-account/confirm");
    renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(true, []));
    expect(screen.getByText(/Kein Token/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("mit ?token → Confirm dispatcht confirm-deletion-by-token + Success", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm?token=tok-123");
    const calls: WriteCall[] = [];
    renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(true, calls));

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/vorgemerkt/)).toBeTruthy());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("user-data-rights:write:confirm-deletion-by-token");
    expect(calls[0]?.payload).toEqual({ token: "tok-123" });
  });

  test("write-Failure → invalidToken-Banner, kein Success", async () => {
    window.history.replaceState({}, "", "/delete-account/confirm?token=bad");
    renderWith(<ConfirmAccountDeletionScreen />, makeDispatcher(false, []));

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText(/ungültig oder abgelaufen/)).toBeTruthy());
    expect(screen.queryByText(/vorgemerkt/)).toBeNull();
  });
});
