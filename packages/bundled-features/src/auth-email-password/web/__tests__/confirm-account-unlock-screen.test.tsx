import { afterAll, describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { ConfirmAccountUnlockScreen } from "../confirm-account-unlock-screen.tsx";
import { installFetchMock } from "./fetch-mock.ts";
import { renderWithProviders } from "./test-utils.tsx";

// Tests below replace globalThis.fetch; restore it so later files in the shared DOM run get the real one.
const originalFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

installFetchMock();

describe("ConfirmAccountUnlockScreen", () => {
  test("without token → missing-token page", () => {
    renderWithProviders(<ConfirmAccountUnlockScreen />);
    expect(screen.getByText(/missing a token/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to sign in" }).getAttribute("href")).toBe("/login");
  });

  test("with token + 200 → success after auto-submit", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ConfirmAccountUnlockScreen token="unlock-tok" loginHref="/home" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/confirm-account-unlock",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
          credentials: "same-origin",
          body: JSON.stringify({ token: "unlock-tok" }),
        }),
      );
      expect(screen.getByText("Account unlocked")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Go to sign in" }).getAttribute("href")).toBe("/home");
  });

  test("with token + 422 → error state", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: { code: "invalid_unlock_token" } }), { status: 422 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<ConfirmAccountUnlockScreen token="bad" />);

    await waitFor(() => {
      expect(screen.getByText("Unlock failed")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeTruthy();
  });

  test("custom title on missing-token uses errorTitle slot only when set", () => {
    renderWithProviders(<ConfirmAccountUnlockScreen title="Unlock kaputt" />);
    expect(screen.getByText("Unlock kaputt")).toBeTruthy();
    expect(screen.queryByText("Unlock failed")).toBeNull();
  });
});
