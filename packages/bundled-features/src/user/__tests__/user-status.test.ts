// Drift guard for USER_STATUS.
//
// USER_STATUS_OPTIONS is not exported directly (it is private in
// schema/user.ts), but is referenced through createSelectField in the
// entity. If the USER_STATUS object is extended without synchronizing the
// tuple, this test catches it — entity.fields.status provides the options
// list.

import { describe, expect, test } from "bun:test";
import { USER_STATUS, userEntity } from "../schema/user.ts";

describe("USER_STATUS — Drift-Guard (S2.D2.5 N1)", () => {
  test("Snapshot-Vergleich: USER_STATUS-Object und entity.fields.status.options synchron", () => {
    const objectValues = Object.values(USER_STATUS).sort();
    // entity.fields.status uses createSelectField; options is the tuple
    const statusField = userEntity.fields["status"] as { options: readonly string[] };
    const optionValues = [...statusField.options].sort();

    expect(optionValues).toEqual(objectValues);
  });

  test("USER_STATUS-Snapshot — explizit zu updaten bei Aenderungen", () => {
    expect(USER_STATUS).toMatchInlineSnapshot(`
      {
        "Active": "active",
        "Deleted": "deleted",
        "DeletionRequested": "deletionRequested",
        "Restricted": "restricted",
      }
    `);
  });

  test("USER_STATUS-Werte sind camelCase (Convention fuer status-Strings)", () => {
    // All values must start with lowercase and contain no spaces
    for (const value of Object.values(USER_STATUS)) {
      expect(value).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });
});
