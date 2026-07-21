import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { ConfirmAccountUnlockScreen } from "../confirm-account-unlock-screen";
import { renderWithProviders } from "./test-utils";

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {});

describe("ConfirmAccountUnlockScreen", () => {
  test("ohne Token → missing-token page", () => {
    renderWithProviders(<ConfirmAccountUnlockScreen />);
    expect(screen.getByText(/enthält keinen Token/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Zum Login" }).getAttribute("href")).toBe("/login");
  });

  test("mit Token + 200 → success after auto-submit", async () => {
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    renderWithProviders(<ConfirmAccountUnlockScreen token="unlock-tok" loginHref="/home" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/confirm-account-unlock",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "unlock-tok" }),
        }),
      );
      expect(screen.getByText("Konto entsperrt")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Zum Login" }).getAttribute("href")).toBe("/home");
  });

  test("mit Token + 422 → error state", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: { code: "invalid_unlock_token" } }), { status: 422 }),
    ) as unknown as typeof fetch;

    renderWithProviders(<ConfirmAccountUnlockScreen token="bad" />);

    await waitFor(() => {
      expect(screen.getByText("Entsperren fehlgeschlagen")).toBeTruthy();
    });
    expect(screen.getByRole("link", { name: "Zum Login" })).toBeTruthy();
  });

  test("custom title on missing-token uses errorTitle slot only when set", () => {
    renderWithProviders(<ConfirmAccountUnlockScreen title="Unlock kaputt" />);
    expect(screen.getByText("Unlock kaputt")).toBeTruthy();
  });
});
