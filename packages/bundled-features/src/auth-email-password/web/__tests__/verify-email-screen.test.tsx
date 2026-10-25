import { afterAll, describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { VerifyEmailScreen } from "../verify-email-screen.tsx";
import { installFetchMock } from "./fetch-mock.ts";
import { renderWithProviders } from "./test-utils.tsx";

// Tests below replace globalThis.fetch; restore it so later files in the shared DOM run get the real one.
const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

installFetchMock();

describe("VerifyEmailScreen", () => {
  test("without a token → missing-token page", () => {
    renderWithProviders(<VerifyEmailScreen />);
    expect(screen.getByText(/missing a token/i)).toBeTruthy();
  });

  test("with a token + 200 → success state after auto-submit", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<VerifyEmailScreen token="t-abc" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/verify-email",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "t-abc" }),
        }),
      );
      expect(screen.getByText("Email verified")).toBeTruthy();
    });
  });

  test("with a token + 422 → error state", async () => {
    const errBody = JSON.stringify({
      error: {
        code: "invalid_verification_token",
        details: { reason: "invalid_verification_token" },
      },
    });
    globalThis.fetch = mock(
      async () => new Response(errBody, { status: 422 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<VerifyEmailScreen token="bad" />);

    await waitFor(() => {
      expect(screen.getByText("Verification failed")).toBeTruthy();
    });
  });
});
