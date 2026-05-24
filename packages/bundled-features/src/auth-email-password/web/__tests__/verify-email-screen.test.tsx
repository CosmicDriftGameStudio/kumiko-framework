import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { VerifyEmailScreen } from "../verify-email-screen";
import { renderWithProviders } from "./test-utils";

beforeEach(() => {
  globalThis.fetch = mock(async () => new Response(null, { status: 200 }));
});
afterEach(() => {});

describe("VerifyEmailScreen", () => {
  test("ohne Token → missing-token-Page", () => {
    renderWithProviders(<VerifyEmailScreen />);
    expect(screen.getByText(/enthält keinen Token/i)).toBeTruthy();
  });

  test("mit Token + 200 → success-state nach auto-submit", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock;

    renderWithProviders(<VerifyEmailScreen token="t-abc" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/verify-email",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "t-abc" }),
        }),
      );
      expect(screen.getByText("E-Mail bestätigt")).toBeTruthy();
    });
  });

  test("mit Token + 422 → error-state", async () => {
    const errBody = JSON.stringify({
      error: {
        code: "invalid_verification_token",
        details: { reason: "invalid_verification_token" },
      },
    });
    globalThis.fetch = mock(async () => new Response(errBody, { status: 422 }));

    renderWithProviders(<VerifyEmailScreen token="bad" />);

    await waitFor(() => {
      expect(screen.getByText("Bestätigung fehlgeschlagen")).toBeTruthy();
    });
  });
});
