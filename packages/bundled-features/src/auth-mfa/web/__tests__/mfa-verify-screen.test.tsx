import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { fireEvent, type RenderResult, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { installFetchMock } from "../../../auth-email-password/web/__tests__/fetch-mock.ts";
import { makeSessionApi } from "../../../auth-email-password/web/__tests__/test-utils.tsx";
import { SessionContext } from "../../../auth-email-password/web/session.tsx";
import { defaultTranslations } from "../i18n.ts";
import { MfaVerifyScreen } from "../mfa-verify-screen.tsx";

// Tests below replace globalThis.fetch; restore it so later files in the shared DOM run get the real one.
const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

function renderScreen(ui: ReactElement, session = makeSessionApi()): RenderResult {
  return render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en" })}
        fallbackBundles={[defaultTranslations]}
      >
        <SessionContext.Provider value={session}>{ui}</SessionContext.Provider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
}

installFetchMock();

describe("MfaVerifyScreen", () => {
  test("rendert Titel + Code-Feld + Submit-Button (de)", () => {
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);
    expect(screen.getByText("Two-factor verification")).toBeTruthy();
    expect(screen.getByLabelText(/^Code/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verify" })).toBeTruthy();
  });

  test("richtiger Code → ruft session.refresh() + onSuccess()", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            isSuccess: true,
            token: "t",
            user: { id: "u1", tenantId: "t1", roles: [] },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    const session = makeSessionApi();
    const onSuccess = mock(() => {});
    void renderScreen(
      <MfaVerifyScreen challengeToken="challenge-1" onSuccess={onSuccess} />,
      session,
    );

    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "123456" } });

    await waitFor(() => {
      expect(session.refresh).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  test("invalid code (invalid_totp_code) → Banner with translated text", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ isSuccess: false, error: "invalid_totp_code" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);

    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "000000" } });

    await waitFor(() => {
      expect(screen.getByText("Invalid code. Please try again.")).toBeTruthy();
    });
    const input = screen.getByLabelText(/^Code/);
    expect(input).toHaveProperty("value", "");
    // useFocusOnMount focuses in a passive effect, which can run after the
    // banner commit that ended the waitFor above.
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  test("the sixth digit triggers exactly one submit, non-digits are discarded", async () => {
    const fetchMock = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isSuccess: false, error: "invalid_totp_code" }), {
          status: 200,
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);

    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "12345" } });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "123 456" } });

    await waitFor(() => {
      expect(screen.getByText("Invalid code. Please try again.")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      code: "123456",
    });
  });

  test("Recovery mode: text field, no auto-submit, submit button sends the code", async () => {
    const fetchMock = mock(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isSuccess: false, error: "invalid_recovery_code" }), {
          status: 200,
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    const input = screen.getByLabelText(/^Recovery code/);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "abcd-efgh" } });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      code: "abcd-efgh",
    });
  });

  test("onCancel gesetzt → 'Back to login'-Button vorhanden, klick ruft onCancel", () => {
    const onCancel = mock(() => {});
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to login" }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("without onCancel → no 'Back to login' button", () => {
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);
    expect(screen.queryByRole("button", { name: "Back to login" })).toBeNull();
  });
});
