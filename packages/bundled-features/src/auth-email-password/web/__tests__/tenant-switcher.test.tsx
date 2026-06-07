import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantSwitcher } from "../tenant-switcher";
import { makeSessionApi, renderWithProviders } from "./test-utils";

// Radix-DropdownMenu reagiert auf pointerdown, nicht auf click — daher
// userEvent statt fireEvent.
describe("TenantSwitcher", () => {
  test("renders nothing when user is null", () => {
    const session = makeSessionApi({ status: "unauthenticated", user: null });
    const { container } = renderWithProviders(<TenantSwitcher />, { session });
    expect(container.firstChild).toBeNull();
  });
  test("renders nothing when user has only one tenant", () => {
    const session = makeSessionApi({
      tenants: [{ tenantId: "t1", roles: ["Admin"] }],
    });
    const { container } = renderWithProviders(<TenantSwitcher />, { session });
    expect(container.firstChild).toBeNull();
  });
  test("renders trigger when user has multiple tenants", () => {
    const session = makeSessionApi({
      activeTenantId: "tenant-a",
      tenants: [
        { tenantId: "tenant-a", roles: ["Admin"] },
        { tenantId: "tenant-b", roles: ["User"] },
      ],
    });
    renderWithProviders(<TenantSwitcher tenantName={(id) => `Tenant ${id}`} />, { session });
    // tenantName-Resolver liefert "Tenant tenant-a" als Trigger-Label
    expect(screen.getByText("Tenant tenant-a")).toBeTruthy();
  });
  test("renders server-provided membership name without tenantName prop", () => {
    // /auth/tenants liefert name/key mit — der Switcher braucht keinen
    // App-Resolver mehr. Fallback-Kette: name > key > UUID-Präfix.
    const session = makeSessionApi({
      activeTenantId: "00000000-0000-4000-8000-000000000001",
      tenants: [
        {
          tenantId: "00000000-0000-4000-8000-000000000001",
          roles: ["Admin"],
          name: "Status",
          key: "status",
        },
        { tenantId: "00000000-0000-4000-8000-000000000002", roles: ["Admin"], key: "demo" },
      ],
    });
    renderWithProviders(<TenantSwitcher />, { session });
    // Ohne den Fix wären beide Labels das identische UUID-Präfix "00000000".
    expect(screen.getByText("Status")).toBeTruthy();
  });

  test("opens dropdown showing all memberships with roles", async () => {
    const user = userEvent.setup();
    const session = makeSessionApi({
      activeTenantId: "tenant-a",
      tenants: [
        { tenantId: "tenant-a", roles: ["Admin"] },
        { tenantId: "tenant-b", roles: ["User", "Billing"] },
      ],
    });
    renderWithProviders(<TenantSwitcher tenantName={(id) => `Tenant ${id}`} />, {
      session,
    });
    await user.click(screen.getByRole("button", { name: /Tenant tenant-a/ }));
    // Trigger zeigt aktiven Tenant ("Tenant tenant-a") + Dropdown-Items
    // listen ALLE Tenants — nutze getAllByText um Mehrdeutigkeit
    // explizit zu erlauben, dann Roles-Strings als eindeutigen Anker.
    expect(screen.getAllByText("Tenant tenant-a").length).toBeGreaterThan(0);
    expect(screen.getByText("Tenant tenant-b")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("User, Billing")).toBeTruthy();
  });
  test("clicking a tenant triggers switchTenant", async () => {
    const user = userEvent.setup();
    const session = makeSessionApi({
      activeTenantId: "tenant-a",
      tenants: [
        { tenantId: "tenant-a", roles: ["Admin"] },
        { tenantId: "tenant-b", roles: ["User"] },
      ],
    });
    renderWithProviders(<TenantSwitcher tenantName={(id) => `Tenant ${id}`} />, {
      session,
    });
    await user.click(screen.getByRole("button", { name: /Tenant tenant-a/ }));
    await user.click(screen.getByText("Tenant tenant-b"));
    expect(session.switchTenant).toHaveBeenCalledWith("tenant-b");
  });
  test("clicking the active tenant is a no-op (closes menu, no switch call)", async () => {
    const user = userEvent.setup();
    const session = makeSessionApi({
      activeTenantId: "tenant-a",
      tenants: [
        { tenantId: "tenant-a", roles: ["Admin"] },
        { tenantId: "tenant-b", roles: ["User"] },
      ],
    });
    renderWithProviders(<TenantSwitcher tenantName={(id) => `Tenant ${id}`} />, {
      session,
    });
    await user.click(screen.getByRole("button", { name: /Tenant tenant-a/ }));
    // Im Dropdown gibt's einen menuitemcheckbox für tenant-a (Radix-Role
    // bei CheckboxItem) — nicht den Trigger erwischen, sondern den im
    // role="menu".
    const items = screen.getAllByRole("menuitemcheckbox");
    const activeItem = items.find((el) => el.textContent?.includes("Tenant tenant-a"));
    expect(activeItem).toBeDefined();
    if (activeItem) await user.click(activeItem);
    expect(session.switchTenant).not.toHaveBeenCalled();
  });
});
