// Update-Erkennung: die Korrektheitsgrenze ist der ID-Vergleich, nicht die
// Listener-Verdrahtung. shouldShowUpdate kapselt die "nie ein Fake-Banner"-
// Invariante — hier die vier Fälle direkt geprüft.

import { describe, expect, test } from "bun:test";
import { shouldShowUpdate } from "../update-checker";

describe("shouldShowUpdate", () => {
  test("andere Server-id als geladen → Banner", () => {
    expect(shouldShowUpdate("aaa", { id: "bbb", builtAt: "2026-06-18T00:00:00Z" })).toBe(true);
  });

  test("gleiche id → kein Banner", () => {
    expect(shouldShowUpdate("aaa", { id: "aaa", builtAt: "2026-06-18T00:00:00Z" })).toBe(false);
  });

  test("kein Server-Stand (Fetch-Fehler/kaputtes JSON → null) → kein Banner", () => {
    expect(shouldShowUpdate("aaa", null)).toBe(false);
  });

  test("kein geladener Stand (Dev/altes Bundle) → kein Banner, auch bei Server-Drift", () => {
    expect(shouldShowUpdate(undefined, { id: "bbb", builtAt: "2026-06-18T00:00:00Z" })).toBe(false);
    expect(shouldShowUpdate("", { id: "bbb", builtAt: "2026-06-18T00:00:00Z" })).toBe(false);
  });
});
