import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, type RenderResult, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { makeSessionApi } from "../../../auth-email-password/web/__tests__/test-utils";
import { SessionContext } from "../../../auth-email-password/web/session";
import { defaultTranslations } from "../i18n";
import { MfaVerifyScreen } from "../mfa-verify-screen";

function renderScreen(ui: ReactElement, session = makeSessionApi()): RenderResult {
  return render(
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de" })}
        fallbackBundles={[defaultTranslations]}
      >
        <SessionContext.Provider value={session}>{ui}</SessionContext.Provider>
      </LocaleProvider>
    </PrimitivesProvider>,
  );
}

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {});

describe("MfaVerifyScreen", () => {
  test("rendert Titel + Code-Feld + Submit-Button (de)", () => {
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);
    expect(screen.getByText("Zwei-Faktor-Bestätigung")).toBeTruthy();
    expect(screen.getByLabelText(/^Code/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bestätigen" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));

    await waitFor(() => {
      expect(session.refresh).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  test("falscher Code (invalid_totp_code) → Banner mit übersetztem Text", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ isSuccess: false, error: "invalid_totp_code" }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);

    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Bestätigen" }));

    await waitFor(() => {
      expect(screen.getByText("Ungültiger Code. Bitte erneut versuchen.")).toBeTruthy();
    });
  });

  test("onCancel gesetzt → 'Zurück zum Login'-Button vorhanden, klick ruft onCancel", () => {
    const onCancel = mock(() => {});
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Zurück zum Login" }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("ohne onCancel → kein 'Zurück zum Login'-Button", () => {
    void renderScreen(<MfaVerifyScreen challengeToken="challenge-1" />);
    expect(screen.queryByRole("button", { name: "Zurück zum Login" })).toBeNull();
  });
});
