// Unit-Tests für die neuen Time-Field-Factories
// (createTimestampField, createTzField, createLocatedTimestampField).
//
// Test-Fokus: korrektes Field-Shape + locatedBy-Marker-Verdrahtung. Die
// echte TZ-Konvertierung (Wall-Clock ↔ UTC) testen wir später beim
// DB-Wrapper-Schritt.

import { describe, expect, test } from "bun:test";
import { createLocatedTimestampField, createTimestampField, createTzField } from "../factories";

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
