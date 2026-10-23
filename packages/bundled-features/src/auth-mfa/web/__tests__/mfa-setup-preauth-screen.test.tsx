import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createStaticLocaleResolver,
  LocaleProvider,
  PrimitivesProvider,
} from "@cosmicdrift/kumiko-renderer";
import { defaultPrimitives } from "@cosmicdrift/kumiko-renderer/web";
import { mockModuleForFile } from "@cosmicdrift/kumiko-testing/helpers/mock-module";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { defaultTranslations } from "../i18n.ts";

// Tests below replace globalThis.fetch; restore it so later files in the shared DOM run get the real one.
const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

mockModuleForFile("qrcode/lib/browser.js", await import("qrcode/lib/browser.js"), {
  default: { toString: mock(async () => "<svg></svg>") },
});

const { MfaSetupPreauthScreen } = await import("../mfa-setup-preauth-screen.tsx");

function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <PrimitivesProvider value={defaultPrimitives}>
      <LocaleProvider
        resolver={createStaticLocaleResolver({ locale: "en" })}
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
    expect(screen.getByText("Two-factor authentication required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start setup" })).toBeTruthy();
    expect(screen.queryByLabelText(/^Code from your authenticator app/)).toBeNull();
  });

  test("Start-Klick → postet preauthSetupToken+accountLabel, danach QR + Recovery-Codes", async () => {
    const fetchMock = mock(async () => jsonResponse(startBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });

    const confirm = screen.getByRole("button", { name: "Complete setup" });
    expect(confirm).toHaveProperty("disabled", true);
    expect(screen.getByLabelText(/^Code from your authenticator app/)).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(screen.getByLabelText("I've saved my recovery codes."));
    expect(confirm).toHaveProperty("disabled", true);

    const fetchMock = mock(async () => jsonResponse(confirmBody));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fireEvent.change(screen.getByLabelText(/^Code from your authenticator app/), {
      target: { value: "12345" },
    });
    expect(confirm).toHaveProperty("disabled", true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sechste Ziffer bestätigt automatisch → postet setupToken+code, danach onSuccess", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("I've saved my recovery codes."));
    fireEvent.change(screen.getByLabelText(/^Code from your authenticator app/), {
      target: { value: "123456" },
    });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;

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

    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));

    await waitFor(() => {
      expect(screen.getByText("Two-factor authentication is already enabled.")).toBeTruthy();
    });
    expect(screen.queryByText("ABCD1234")).toBeNull();
  });

  test("onCancel gesetzt → 'Back to login'-Button vorhanden, klick ruft onCancel", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Back to login" }));
    expect(onCancel).toHaveBeenCalled();
  });

  test("ohne onCancel → kein 'Back to login'-Button", () => {
    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );
    expect(screen.queryByRole("button", { name: "Back to login" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("I've saved my recovery codes."));
    fireEvent.change(screen.getByLabelText(/^Code from your authenticator app/), {
      target: { value: "000000" },
    });

    await waitFor(() => {
      expect(screen.getByText("Invalid code. Please try again.")).toBeTruthy();
    });
    expect(onSuccess).not.toHaveBeenCalled();
    // Form stays usable — QR/recovery section is still there, a retry is possible.
    expect(screen.getByText("ABCD1234")).toBeTruthy();
    const input = screen.getByLabelText(/^Code from your authenticator app/);
    expect(input).toHaveProperty("value", "");
    expect(input).toHaveProperty("disabled", false);
    // useFocusOnMount focuses in a passive effect, which can run after the banner render.
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  // The banner told the user to "start over", but setup stayed
  // non-null — the intro block (with the only "start setup" button) never
  // came back, leaving the user stuck without a reload (which loses the
  // preauthSetupToken entirely).
  test("confirm schlägt mit invalid_setup_token fehl → Neustart-Pfad: Start-Button kommt zurück (#1470)", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("I've saved my recovery codes."));
    fireEvent.change(screen.getByLabelText(/^Code from your authenticator app/), {
      target: { value: "123456" },
    });

    await waitFor(() => {
      expect(screen.getByText("Setup expired. Please start again.")).toBeTruthy();
    });
    // The actual fix: intro re-appears with a working start button, the QR/
    // recovery-codes section from the dead setup is gone.
    expect(screen.getByRole("button", { name: "Start setup" })).toBeTruthy();
    expect(screen.queryByText("ABCD1234")).toBeNull();
  });

  test("confirm schlägt mit invalid_challenge_token fehl → auch Neustart-Pfad (#1470)", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("preauth-enable-start")) return jsonResponse(startBody);
      if (url.includes("preauth-confirm")) {
        return jsonResponse({ isSuccess: false, error: "invalid_challenge_token" });
      }
      return jsonResponse({ isSuccess: false, error: "unexpected_url" }, 500);
    }) as unknown as typeof fetch;

    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("I've saved my recovery codes."));
    fireEvent.change(screen.getByLabelText(/^Code from your authenticator app/), {
      target: { value: "123456" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start setup" })).toBeTruthy();
    });
  });

  // confirmMfaSetupPreauth already extracts
  // retryAfterSeconds from error.details (see mfa-client.test.ts), but the
  // screen used to drop it and show a generic "too many attempts" banner
  // with no wait-time. Pins that the seconds actually reach the UI.
  test("confirm schlägt mit too_many_attempts fehl → Banner zeigt retryAfterSeconds (#1470)", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("preauth-enable-start")) return jsonResponse(startBody);
      if (url.includes("preauth-confirm")) {
        return jsonResponse({
          isSuccess: false,
          error: { code: "too_many_attempts", details: { retryAfterSeconds: 42 } },
        });
      }
      return jsonResponse({ isSuccess: false, error: "unexpected_url" }, 500);
    }) as unknown as typeof fetch;

    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("I've saved my recovery codes."));
    fireEvent.change(screen.getByLabelText(/^Code from your authenticator app/), {
      target: { value: "123456" },
    });

    await waitFor(() => {
      expect(
        screen.getByText("Too many failed attempts. Try again in 42 seconds, or sign in again."),
      ).toBeTruthy();
    });
  });

  // Server validates z.string().length(6): a 7th pasted digit is cut off
  // instead of reaching the server as invalid_body.
  test("7-stelliger Paste wird auf 6 Ziffern gekürzt und so gesendet", async () => {
    render(
      <Wrapper>
        <MfaSetupPreauthScreen preauthSetupToken="preauth-1" accountLabel="user@example.com" />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await waitFor(() => {
      expect(screen.getByText("ABCD1234")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("I've saved my recovery codes."));
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
    fireEvent.change(screen.getByLabelText(/^Code from your authenticator app/), {
      target: { value: "1234567" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/mfa/preauth-confirm",
        expect.objectContaining({
          body: JSON.stringify({ setupToken: "setup-token-1", code: "123456" }),
        }),
      );
    });
  });
});
