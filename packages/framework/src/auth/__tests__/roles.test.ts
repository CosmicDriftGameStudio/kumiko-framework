// Snapshot-Tests fuer ROLES + Legacy-Aliase. Faengt stille Drift ab.

import { describe, expect, test } from "vitest";
import { ROLE_LEGACY_ALIASES, ROLES } from "../roles";

describe("ROLES constants", () => {
  test("Snapshot — explizit zu updaten bei Aenderungen", () => {
    expect(ROLES).toMatchInlineSnapshot(`
      {
        "DataProtectionOfficer": "DataProtectionOfficer",
        "Member": "Member",
        "PlatformAdmin": "PlatformAdmin",
        "TenantAdmin": "TenantAdmin",
        "TenantOwner": "TenantOwner",
      }
    `);
  });

  test("ROLES-Werte sind identisch zu den Keys (keine Drift im Mapping)", () => {
    for (const [key, value] of Object.entries(ROLES)) {
      expect(value).toBe(key);
    }
  });
});

describe("ROLE_LEGACY_ALIASES", () => {
  test('"Admin" ist Alias auf TenantAdmin (Memory feedback_role_naming_drift)', () => {
    expect(ROLE_LEGACY_ALIASES["Admin"]).toBe(ROLES.TenantAdmin);
  });

  test("Alle Alias-Targets sind gueltige ROLES-Werte", () => {
    const validRoles = new Set(Object.values(ROLES));
    for (const target of Object.values(ROLE_LEGACY_ALIASES)) {
      expect(validRoles.has(target)).toBe(true);
    }
  });
});
