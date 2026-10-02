import { describe, expect, test } from "bun:test";
import { createInviteCreateHandler } from "../handlers/invite-create.write.js";

const APP_URL = "https://app.example/accept-invite";

describe("invite-create additionalAssignableRoles", () => {
  test("rejects framework-ranked roles at construction", () => {
    for (const role of ["User", "Editor", "Admin", "TenantAdmin", "SystemAdmin"]) {
      expect(() =>
        createInviteCreateHandler({ appUrl: APP_URL, additionalAssignableRoles: [role] }),
      ).toThrow(/framework-ranked/);
    }
  });

  test("accepts app-defined roles", () => {
    expect(() =>
      createInviteCreateHandler({
        appUrl: APP_URL,
        additionalAssignableRoles: ["Billing", "Reviewer"],
      }),
    ).not.toThrow();
  });
});
