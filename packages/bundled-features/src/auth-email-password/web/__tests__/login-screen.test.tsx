// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LoginScreen } from "../login-screen";
import { makeSessionApi, renderWithProviders } from "./test-utils";

describe("LoginScreen", () => {
  test("renders translated title + email + password labels (de)", () => {
    renderWithProviders(<LoginScreen />);
    expect(screen.getByText("Anmelden")).toBeTruthy();
    expect(screen.getByLabelText("E-Mail")).toBeTruthy();
    expect(screen.getByLabelText("Passwort")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Einloggen" })).toBeTruthy();
  });

  test("submit calls session.login with form values", async () => {
    const session = makeSessionApi({ status: "unauthenticated", user: null });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText("E-Mail"), {
      target: { value: "demo@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Passwort"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));

    await waitFor(() => {
      expect(session.login).toHaveBeenCalledWith({
        email: "demo@example.com",
        password: "secret",
      });
    });
  });

  test("invalid_credentials → renders translated error message", async () => {
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: vi.fn(async () => ({ ok: false, error: { reason: "invalid_credentials" } })),
    });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText("E-Mail"), {
      target: { value: "wrong@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Passwort"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toBe("E-Mail oder Passwort falsch.");
    });
  });

  test("account_locked with retryAfterSeconds renders interpolated minutes", async () => {
    const session = makeSessionApi({
      status: "unauthenticated",
      user: null,
      login: vi.fn(async () => ({
        ok: false,
        error: { reason: "account_locked", retryAfterSeconds: 540 },
      })),
    });
    renderWithProviders(<LoginScreen />, { session });

    fireEvent.change(screen.getByLabelText("E-Mail"), {
      target: { value: "x@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Passwort"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Einloggen" }));

    await waitFor(() => {
      // 540s → 9 Minuten (Math.ceil)
      expect(screen.getByRole("alert").textContent).toMatch(/9 Minuten/);
    });
  });
});
