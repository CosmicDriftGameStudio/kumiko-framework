// Snapshot tests for ROLES — catch silent drift.

import { describe, expect, test } from "bun:test";
import { ROLES } from "../roles.ts";

describe("ROLES constants", () => {
  test("Snapshot — explicitly update when changes are made", () => {
    expect(ROLES).toMatchInlineSnapshot(`
      {
        "DataProtectionOfficer": "DataProtectionOfficer",
        "Member": "Member",
        "SystemAdmin": "SystemAdmin",
        "TenantAdmin": "TenantAdmin",
        "TenantOwner": "TenantOwner",
      }
    `);
  });

  test("ROLES values are identical to the keys (no drift in the mapping)", () => {
    for (const [key, value] of Object.entries(ROLES)) {
      expect(value as string).toBe(key);
    }
  });
});
