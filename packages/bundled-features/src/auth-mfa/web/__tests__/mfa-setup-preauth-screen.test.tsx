import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer-web";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n";

mock.module("qrcode/lib/browser", () => ({
  default: { toString: mock(async () => "<svg></svg>") },
}));

const { MfaSetupPreauthScreen } = await import("../mfa-setup-preauth-screen");

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "de" })}
        fallbackBundles={[defaultTranslations]}
      >
        {children}
      </LocaleProvider>
    </PrimitivesProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const startBody = {
  isSuccess: true,
  setupToken: "setup-token-1",
  otpauthUri: "otpauth://totp/App:user@example.com?secret=ABCD1234&issuer=App",
  recoveryCodes: ["code-1", "code-2"],
};
const confirmBody = {
  isSuccess: true,
  token: "t",
  user: { id: "u1", tenantId: "t1", roles: [] },
};

beforeEach(() => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("preauth-enable-start")) return jsonResponse(startBody);
    if (url.includes("preauth-confirm")) return jsonResponse(confirmBody);
    return jsonResponse({ isSuccess: false, error: "unexpected_url" }, 500);
  }) as unknown as typeof fetch;
});

describe("MfaSetupPreauthScreen", () => {
  test("rendert Titel + Start-Button, kein Setup-Bereich vor dem Start", () => {
    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );
    expect(screen.getByText("Zwei-Faktor-Authentifizierung erforderlich")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Einrichtung starten" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Code aus der Authenticator-App/)).toBeNull();
  });

  test("Start-Klick → postet preauthSetupToken+accountLabel, danach QR + Recovery-Codes", async () => {
    const fetchMock = mock(async () => jsonResponse(startBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/mfa/preauth-enable-start",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            preauthSetupToken: "preauth-1",
            accountLabel: "user@example.com",
          }),
        }),
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
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });

    const confirm = screen.getByRole("button", {
      name: "Einrichtung abschließen",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Ich habe die Recovery-Codes gespeichert."));
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^Code aus der Authenticator-App/), {
      target: { value: "123456" },
    });
    expect(confirm.disabled).toBe(false);
  });

  test("Bestätigen → postet setupToken+code, danach onSuccess", async () => {
    const onSuccess = mock(() => {});
    render(
      <Wrapper>
        <MfaSetupPreauthScreen
          preauthSetupToken="preauth-1"
          accountLabel="user@example.com"
          onSuccess={onSuccess}
        />
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

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    fireEvent.click(screen.getByRole("button", { name: "Einrichtung abschließen" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/mfa/preauth-confirm",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ setupToken: "setup-token-1", code: "123456" }),
        }),
      );
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  test("enable-start schlägt fehl → übersetztes Fehler-Banner, kein Setup-Bereich", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: false, error: "mfa_already_enabled" }),
    ) as unknown as typeof fetch;
    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));

    await waitFor(() => {
      expect(screen.getByText("Zwei-Faktor-Authentifizierung ist bereits aktiv.")).toBeTruthy();
    });
    expect(screen.queryByText("ABCD1234")).toBeNull();
  });

  test("onCancel gesetzt → 'Zurück zum Login'-Button vorhanden, klick ruft onCancel", () => {
    const onCancel = mock(() => {});
    render(
      <Wrapper>
        <MfaSetupPreauthScreen
          preauthSetupToken="preauth-1"
          accountLabel="user@example.com"
          onCancel={onCancel}
        />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Zurück zum Login" }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("ohne onCancel → kein 'Zurück zum Login'-Button", () => {
    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );
    expect(screen.queryByRole("button", { name: "Zurück zum Login" })).toBeNull();
  });

  test("confirm schlägt mit invalid_totp_code fehl → übersetztes Banner, onSuccess NICHT gefeuert, Formular weiter bedienbar", async () => {
    const onSuccess = mock(() => {});
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("preauth-enable-start")) return jsonResponse(startBody);
      if (url.includes("preauth-confirm")) {
        return jsonResponse({ isSuccess: false, error: "invalid_totp_code" });
      }
      return jsonResponse({ isSuccess: false, error: "unexpected_url" }, 500);
    }) as unknown as typeof fetch;

    render(
      <Wrapper>
        <MfaSetupPreauthScreen
          preauthSetupToken="preauth-1"
          accountLabel="user@example.com"
          onSuccess={onSuccess}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Einrichtung starten" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("Ich habe die Recovery-Codes gespeichert."));
    fireEvent.change(screen.getByLabelText(/^Code aus der Authenticator-App/), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einrichtung abschließen" }));

    await waitFor(() => {
      expect(screen.getByText("Ungültiger Code. Bitte erneut versuchen.")).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    // Formular bleibt bedienbar — QR/Recovery-Bereich ist noch da, ein neuer Versuch ist möglich.
    expect(screen.getByText("ABCD1234")).toBeTruthy();
    const confirm = screen.getByRole("button", {
      name: "Einrichtung abschließen",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  test("confirm schlägt mit invalid_setup_token fehl → übersetztes Banner (Neustart-Pfad)", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("preauth-enable-start")) return jsonResponse(startBody);
      if (url.includes("preauth-confirm")) {
        return jsonResponse({ isSuccess: false, error: "invalid_setup_token" });
      }
      return jsonResponse({ isSuccess: false, error: "unexpected_url" }, 500);
    }) as unknown as typeof fetch;

    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
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
    fireEvent.click(screen.getByRole("button", { name: "Einrichtung abschließen" }));

    await waitFor(() => {
      expect(
        screen.getByText("Die Einrichtung ist abgelaufen. Bitte erneut starten."),
      ).toBeTruthy();
    });
  });
});
