import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { makeSessionApi } from "../../../auth-email-password/web/__tests__/test-utils";
import { SessionContext } from "../../../auth-email-password/web/session";
import { defaultTranslations } from "../i18n";

type WriteResult =
  | { readonly isSuccess: true; readonly data: unknown }
  | { readonly isSuccess: false; readonly error: { readonly i18nKey: string } };

const dispatchSpy = mock<() => Promise<WriteResult>>(async () => ({
  isSuccess: true,
  data: {
    setupToken: "setup-token-1",
    otpauthUri: "otpauth://totp/App:user@example.com?secret=ABCD1234&issuer=App",
    recoveryCodes: ["code-1", "code-2"],
  },
}));

const actual_renderer = await import("@cosmicdrift/kumiko-renderer");
mock.module("@cosmicdrift/kumiko-renderer", () => ({
  ...actual_renderer,
  useDispatcher: mock(() => ({ write: dispatchSpy, query: mock(), batch: mock() })),
}));

mock.module("qrcode/lib/browser", () => ({
  default: { toString: mock(async () => "<svg></svg>") },
}));

const { MfaEnableScreen } = await import("../mfa-enable-screen");

const session = makeSessionApi();

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de" })}
        fallbackBundles={[defaultTranslations]}
      >
        <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
      </LocaleProvider>
    </PrimitivesProvider>
  );
}

beforeEach(() => {
  dispatchSpy.mockClear();
});

describe("MfaEnableScreen", () => {
  test("rendert Intro + Start-Button, kein Setup-Bereich vor dem Start", () => {
    render(
      <Wrapper>
        <MfaEnableScreen />
      </Wrapper>,
    );
    expect(screen.getByText("Zwei-Faktor-Authentifizierung")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Einrichtung starten" })).toBeTruthy();
    expect(screen.queryByLabelText("Code aus der Authenticator-App")).toBeNull();
  });

  test("Start-Klick → dispatcher.write ruft enable-start, danach Setup-Bereich mit Secret + Recovery-Codes", async () => {
    render(
      <Wrapper>
        <MfaEnableScreen />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        "auth-mfa:write:enable-start",
        expect.objectContaining({ accountLabel: "user@example.com" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    expect(screen.getByText(/code-1/)).toBeTruthy();
    expect(screen.getByText(/code-2/)).toBeTruthy();
  });

  test("Bestätigen-Button bleibt disabled bis Recovery-Codes bestätigt + 6-stelliger Code eingegeben", async () => {
    render(
      <Wrapper>
        <MfaEnableScreen />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });

    const confirm = screen.getByRole("button", { name: "Aktivieren" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Ich habe die Recovery-Codes gespeichert."));
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Code aus der Authenticator-App/), {
      target: { value: "123456" },
    });
    expect(confirm.disabled).toBe(false);
  });

  test("Bestätigen → dispatcher.write ruft enable-confirm, danach Success-Banner", async () => {
    dispatchSpy
      .mockImplementationOnce(async () => ({
        isSuccess: true,
        data: {
          setupToken: "setup-token-1",
          otpauthUri: "otpauth://totp/App:user@example.com?secret=ABCD1234&issuer=App",
          recoveryCodes: ["code-1", "code-2"],
        },
      }))
      .mockImplementationOnce(async () => ({ isSuccess: true, data: undefined }));
    const onEnabled = mock(() => {});
    render(
      <Wrapper>
        <MfaEnableScreen onEnabled={onEnabled} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("Ich habe die Recovery-Codes gespeichert."));
    fireEvent.change(screen.getByLabelText(/^Code aus der Authenticator-App/), {
      target: { value: "123456" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Aktivieren" }));

    await waitFor(() => {
      expect(dispatchSpy).toHaveBeenCalledWith(
        "auth-mfa:write:enable-confirm",
        expect.objectContaining({ setupToken: "setup-token-1", code: "123456" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Zwei-Faktor-Authentifizierung ist jetzt aktiv.")).toBeTruthy();
      expect(onEnabled).toHaveBeenCalled();
    });
  });

  test("enable-start schlägt fehl → übersetztes Fehler-Banner, kein Setup-Bereich", async () => {
    dispatchSpy.mockImplementationOnce(async () => ({
      isSuccess: false,
      error: { i18nKey: "auth.mfa.errors.mfaAlreadyEnabled" },
    }));
    render(
      <Wrapper>
        <MfaEnableScreen />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));

    await waitFor(() => {
      expect(screen.getByText("Zwei-Faktor-Authentifizierung ist bereits aktiv.")).toBeTruthy();
    });
    expect(screen.queryByText("ABCD1234")).toBeNull();
  });
});
