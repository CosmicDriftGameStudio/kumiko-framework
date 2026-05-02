// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import { UserMenu } from "../user-menu";
import { makeSessionApi, renderWithProviders } from "./test-utils";

// Radix-DropdownMenu reagiert auf pointerdown — fireEvent.click greift
// dort nicht. userEvent simuliert die volle Pointer-Sequenz und Radix
// öffnet sauber.

describe("UserMenu", () => {
  test("renders nothing when user is null", () => {
    const session = makeSessionApi({ status: "unauthenticated", user: null });
    const { container } = renderWithProviders(<UserMenu />, { session });
    expect(container.firstChild).toBeNull();
  });

  test("shows displayName + initials when authenticated", () => {
    const session = makeSessionApi({
      user: { id: "u1", email: "alice@example.com", displayName: "Alice Wonder", globalRoles: [] },
    });
    renderWithProviders(<UserMenu />, { session });
    // Avatar = "AW", Display-Name "Alice Wonder"
    expect(screen.getByText("AW")).toBeTruthy();
    expect(screen.getByText("Alice Wonder")).toBeTruthy();
  });

  test("falls back to email-based initials when displayName empty", () => {
    const session = makeSessionApi({
      user: { id: "u1", email: "bob@example.com", displayName: "", globalRoles: [] },
    });
    renderWithProviders(<UserMenu />, { session });
    // Trim "" → leerer displayName → fallback auf email → erste 2 Chars
    expect(screen.getByText("BO")).toBeTruthy();
  });

  test("opens dropdown on click and shows logout button", async () => {
    const user = userEvent.setup();
    const session = makeSessionApi();
    renderWithProviders(<UserMenu />, { session });
    await user.click(screen.getByRole("button", { name: /Test User/ }));
    expect(screen.getByText("Abmelden")).toBeTruthy();
    expect(screen.getByText("user@example.com")).toBeTruthy();
  });

  test("logout-click triggers session.logout", async () => {
    const user = userEvent.setup();
    const session = makeSessionApi();
    renderWithProviders(<UserMenu />, { session });
    await user.click(screen.getByRole("button", { name: /Test User/ }));
    await user.click(screen.getByText("Abmelden"));
    expect(session.logout).toHaveBeenCalledOnce();
  });
});
