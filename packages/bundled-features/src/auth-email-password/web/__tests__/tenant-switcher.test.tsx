// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TenantSwitcher } from "../tenant-switcher";
import { makeSessionApi, renderWithProviders } from "./test-utils";

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

  test("opens dropdown showing all memberships with roles", () => {
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
    fireEvent.click(screen.getAllByRole("button")[0]!);
    // Trigger zeigt aktiven Tenant ("Tenant tenant-a") + Dropdown-Items
    // listen ALLE Tenants — nutze getAllByText um Mehrdeutigkeit
    // explizit zu erlauben, dann Roles-Strings als eindeutigen Anker.
    expect(screen.getAllByText("Tenant tenant-a").length).toBeGreaterThan(0);
    expect(screen.getByText("Tenant tenant-b")).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText("User, Billing")).toBeTruthy();
  });

  test("clicking a tenant triggers switchTenant", () => {
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
    fireEvent.click(screen.getAllByRole("button")[0]!);
    fireEvent.click(screen.getByText("Tenant tenant-b"));
    expect(session.switchTenant).toHaveBeenCalledWith("tenant-b");
  });

  test("clicking the active tenant is a no-op (closes menu, no switch call)", () => {
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
    fireEvent.click(screen.getAllByRole("button")[0]!);
    // Im Dropdown gibt's einen menuitem-Button für tenant-a — nicht
    // den Trigger erwischen, sondern den im role="menu".
    const dropdownItems = screen.getAllByRole("menuitem");
    const activeItem = dropdownItems.find((el) => el.textContent?.includes("Tenant tenant-a"));
    expect(activeItem).toBeDefined();
    if (activeItem) fireEvent.click(activeItem);
    expect(session.switchTenant).not.toHaveBeenCalled();
  });
});
