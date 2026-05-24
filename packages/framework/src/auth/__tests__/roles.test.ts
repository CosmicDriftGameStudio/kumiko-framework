// Snapshot-Tests fuer ROLES — faengt stille Drift ab.

import { describe, expect, test } from "bun:test";
import { ROLES } from "../roles";

describe("ROLES constants", () => {
  test("Snapshot — explizit zu updaten bei Aenderungen", () => {
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

  test("ROLES-Werte sind identisch zu den Keys (keine Drift im Mapping)", () => {
    for (const [key, value] of Object.entries(ROLES)) {
      expect(value as string).toBe(key);
    }
  });
});
