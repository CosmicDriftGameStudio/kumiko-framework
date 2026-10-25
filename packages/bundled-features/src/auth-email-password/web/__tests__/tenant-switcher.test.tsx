import { describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TenantSwitcher } from "../tenant-switcher.tsx";
import { makeSessionApi, renderWithProviders } from "./test-utils.tsx";

// Radix-DropdownMenu responds to pointerdown rather than click, so
// use userEvent instead of fireEvent.
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
    // The tenantName resolver provides "Tenant tenant-a" as the trigger label.
    expect(screen.getByText("Tenant tenant-a")).toBeTruthy();
  });
  test("renders server-provided membership name without tenantName prop", () => {
    // /auth/tenants provides name/key, so the switcher no longer needs an
    // app resolver. Fallback order: name > key > UUID prefix.
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
    // Without the fix, both labels would be the identical UUID prefix
    // "00000000".
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
    // The trigger shows the active tenant ("Tenant tenant-a"), and the dropdown lists all tenants.
    // Use getAllByText to allow the duplicate active-tenant label, then use role strings as
    // unambiguous anchors.
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
    // The dropdown contains a menuitemcheckbox for tenant-a (the Radix role
    // for CheckboxItem); select it rather than the trigger in role="menu".
    const items = screen.getAllByRole("menuitemcheckbox");
    const activeItem = items.find((el) => el.textContent?.includes("Tenant tenant-a"));
    expect(activeItem).toBeDefined();
    if (activeItem) await user.click(activeItem);
    expect(session.switchTenant).not.toHaveBeenCalled();
  });
});

describe("TenantSwitcher — key-only fallback in the open dropdown", () => {
  test("Membership without a name renders its key as the dropdown label", async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole("button", { name: /Status/ }));
    // The key-only path (without name) must appear in the dropdown rather
    // than the UUID prefix "00000000".
    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.queryByText("00000000")).toBeNull();
  });
});
