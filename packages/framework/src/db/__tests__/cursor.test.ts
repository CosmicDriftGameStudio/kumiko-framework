// Cursor encoding pinst dass UUID + Integer-IDs beide den gleichen
// Pfad nehmen — vorher hat decodeCursor mit Number.parseInt versucht
// einen UUID zu number zu casten und zurück NaN gegeben, der DB-WHERE-
// Clause hat dann auf "id > NaN" gequeryt → Postgres-Crash. UUIDs
// sind aktuell der Default (Sprint F idType=uuid), also war cursor-
// Pagination strukturell broken vor diesem Fix.

import { describe, expect, test } from "vitest";
import { decodeCursor, encodeCursor } from "../cursor";

describe("encodeCursor + decodeCursor", () => {
  test("UUIDv7-Roundtrip: encoded → decoded gibt denselben UUID-String", () => {
    const uuid = "019dcd94-d6b9-742c-9a3c-43d7972f6243";
    expect(decodeCursor(encodeCursor(uuid))).toBe(uuid);
  });

  test("Integer-Roundtrip: encoded → decoded gibt String-Form (kompatibel)", () => {
    // String/number als Input erlaubt; output ist immer String. PG
    // castet beim WHERE id > '42' selbst auf integer-Spalten korrekt.
    expect(decodeCursor(encodeCursor(42))).toBe("42");
  });

  test("encoded String ist URL-safe base64 (kein /, +, =)", () => {
    const encoded = encodeCursor("019dcd94-d6b9-742c-9a3c-43d7972f6243");
    expect(encoded).not.toMatch(/[/+=]/);
  });

  test("Leerer Cursor (corrupted base64): wirft Invalid-cursor-Error", () => {
    expect(() => decodeCursor("")).toThrow(/Invalid cursor/);
  });

  test("UUIDs sind lexikografisch sort-stabil (UUIDv7-Voraussetzung)", () => {
    // Cursor-Pagination erwartet dass `gt(id, last-id)` die nächste Seite
    // liefert. Bei UUIDv7 ist das time-ordered, also lexikografisch
    // monoton mit Insert-Reihenfolge. Hier nur eine String-Compare-
    // Sanity-Check — die DB-Seite glaubt das default-mäßig.
    const a = "019dcd94-0000-742c-0000-000000000001";
    const b = "019dcd95-0000-742c-0000-000000000002";
    expect(b > a).toBe(true);
  });
});
