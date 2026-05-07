// Drift-Guard fuer USER_STATUS (S2.D2.5 N1).
//
// Plus: USER_STATUS_OPTIONS wird nicht direkt exportiert (private im
// schema/user.ts), wird aber via createSelectField in der Entity
// referenziert. Wenn USER_STATUS-Object erweitert wird ohne dass das
// Tuple synchron mitwaechst, faengt der Test es ab — entity.fields.status
// liefert die options-Liste.

import { describe, expect, test } from "vitest";
import { USER_STATUS, userEntity } from "../schema/user";

describe("USER_STATUS — Drift-Guard (S2.D2.5 N1)", () => {
  test("Snapshot-Vergleich: USER_STATUS-Object und entity.fields.status.options synchron", () => {
    const objectValues = Object.values(USER_STATUS).sort();
    // entity.fields.status ist createSelectField — options ist die Tuple
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
    // Erwartung: alle Werte starten mit lowercase und enthalten kein Leerzeichen
    for (const value of Object.values(USER_STATUS)) {
      expect(value).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });
});
