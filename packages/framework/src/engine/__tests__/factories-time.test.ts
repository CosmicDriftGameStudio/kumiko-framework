// Unit-Tests für die neuen Time-Field-Factories
// (createTimestampField, createTzField, locatedTimestamp).
//
// Test-Fokus: korrektes Field-Shape + locatedBy-Marker-Verdrahtung. Die
// echte TZ-Konvertierung (Wall-Clock ↔ UTC) testen wir später beim
// DB-Wrapper-Schritt.

import { describe, expect, test } from "bun:test";
import {
  createLocatedTimestampField,
  createTimestampField,
  createTzField,
  locatedTimestamp,
} from "../factories";

describe("createTimestampField", () => {
  test("default-Form ist nicht-required UTC-Instant ohne locatedBy", () => {
    expect(createTimestampField()).toEqual({
      type: "timestamp",
      required: false,
    });
  });

  test("kann required gesetzt werden", () => {
    expect(createTimestampField({ required: true })).toEqual({
      type: "timestamp",
      required: true,
    });
  });

  test("kann mit locatedBy markiert werden (für ad-hoc Cases)", () => {
    expect(createTimestampField({ locatedBy: "myTz" })).toEqual({
      type: "timestamp",
      required: false,
      locatedBy: "myTz",
    });
  });

  test("kann sensitive markiert sein (PII / Audit-Schutz)", () => {
    const f = createTimestampField({ sensitive: true });
    expect(f.sensitive).toBe(true);
  });
});

describe("createTzField", () => {
  test("default-Form ist nicht-required IANA-Zone-Slot", () => {
    expect(createTzField()).toEqual({ type: "tz", required: false });
  });

  test("required + access-rules übernimmt Overrides", () => {
    const f = createTzField({
      required: true,
      access: { read: ["Admin"] },
    });
    expect(f.required).toBe(true);
    expect(f.access).toEqual({ read: ["Admin"] });
  });
});

describe("locatedTimestamp(name) Helper", () => {
  test("erzeugt korrektes Pair aus <name>At + <name>Tz mit locatedBy-Verdrahtung", () => {
    const fields = locatedTimestamp("pickup");
    expect(fields).toEqual({
      pickupAt: { type: "timestamp", locatedBy: "pickupTz" },
      pickupTz: { type: "tz" },
    });
  });

  test("required-Override propagiert auf BEIDE Felder", () => {
    const fields = locatedTimestamp("delivery", { required: true });
    expect(fields).toEqual({
      deliveryAt: { type: "timestamp", locatedBy: "deliveryTz", required: true },
      deliveryTz: { type: "tz", required: true },
    });
  });

  test("access-Override propagiert auf BEIDE Felder (Field-Level Read-Access)", () => {
    const fields = locatedTimestamp("internal", {
      access: { read: ["Dispatcher"] },
    });
    expect(fields).toEqual({
      internalAt: {
        type: "timestamp",
        locatedBy: "internalTz",
        access: { read: ["Dispatcher"] },
      },
      internalTz: { type: "tz", access: { read: ["Dispatcher"] } },
    });
  });

  test("locatedBy-Marker zeigt immer auf das EIGENE Tz-Feld (nicht auf einen anderen Namen)", () => {
    // Das ist der Kern des Patterns — wenn die zwei Felder nicht
    // konsistent verdrahtet sind, fliegt der Boot-Validator (kommt in
    // späterer Iteration). Hier prüfen wir die Helper-Garantie.
    for (const name of ["a", "x_y", "long_field_name"]) {
      const fields = locatedTimestamp(name);
      const at = fields[`${name}At`];
      if (!at || at.type !== "timestamp") throw new Error("at field missing");
      expect(at.locatedBy).toBe(`${name}Tz`);
    }
  });

  test("Spread in createEntity-fields Kompositions-tauglich", () => {
    // Realer Use-Case: pickup + delivery in einer Entity, plus normale Felder.
    const entityFields = {
      ...locatedTimestamp("pickup"),
      ...locatedTimestamp("delivery"),
      // Kein Konflikt zwischen den beiden Pairs.
    };
    expect(Object.keys(entityFields).sort()).toEqual([
      "deliveryAt",
      "deliveryTz",
      "pickupAt",
      "pickupTz",
    ]);
  });
});

describe("createLocatedTimestampField (Phase A — atomarer Field-Type)", () => {
  test("default-Form ist nicht-required mit type 'locatedTimestamp'", () => {
    expect(createLocatedTimestampField()).toEqual({
      type: "locatedTimestamp",
      required: false,
    });
  });

  test("required-Override propagiert", () => {
    expect(createLocatedTimestampField({ required: true })).toEqual({
      type: "locatedTimestamp",
      required: true,
    });
  });

  test("access-Override propagiert (Field-Level Read-Access)", () => {
    const f = createLocatedTimestampField({ access: { read: ["Dispatcher"] } });
    expect(f).toEqual({
      type: "locatedTimestamp",
      required: false,
      access: { read: ["Dispatcher"] },
    });
  });

  test("sensitive-Override propagiert (PII-Schutz)", () => {
    const f = createLocatedTimestampField({ sensitive: true });
    expect(f.sensitive).toBe(true);
  });

  test("ein einziges Field-Objekt — kein Pair wie der alte locatedTimestamp helper", () => {
    // Die neue Form: r.entity({ pickup: createLocatedTimestampField() })
    // erzeugt EIN Schema-Feld (nicht zwei). Die zwei DB-Spalten + drei
    // API-Felder kommen aus dem Framework-Auto-Convert (Phase B–D).
    const field = createLocatedTimestampField();
    expect(field.type).toBe("locatedTimestamp");
    // Keine `at`/`tz`/`utc` Sub-Felder im Schema-Object selbst.
    expect("at" in field).toBe(false);
    expect("tz" in field).toBe(false);
  });
});
