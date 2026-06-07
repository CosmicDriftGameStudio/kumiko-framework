// config-helpers Unit-Tests (Phase 1, test-luecken-integration).
//
// Pinnt das Verhalten der von ai-/mail-/file-foundation geteilten
// Narrowing-Helfer — inkl. der non-obvious Grenzfälle: requireDefined
// narrowt NUR `undefined` (nicht falsy), und requireNonEmpty hat zwei
// getrennte Fehlerpfade (undefined vs leer), die über die Error-Message
// unterschieden werden.

import { describe, expect, test } from "bun:test";
import { InternalError, UnconfiguredError } from "@cosmicdrift/kumiko-framework/errors";
import { requireDefined, requireNonEmpty } from "../config-helpers";

describe("requireDefined", () => {
  test("undefined → wirft mit featureName + label + Misconfig-Hinweis", () => {
    expect(() => requireDefined(undefined, "ai-foundation", "apiKey")).toThrow(
      "ai-foundation: 'apiKey' config key resolved to undefined — registry misconfigured (no value + no default)",
    );
  });

  test("undefined → wirft InternalError (500): Dev-Bug, kein Tenant-Gap", () => {
    expect(() => requireDefined(undefined, "ai-foundation", "apiKey")).toThrow(InternalError);
  });

  test("defined Wert → unverändert zurück", () => {
    expect(requireDefined("sk-123", "ai-foundation", "apiKey")).toBe("sk-123");
  });

  test("falsy-aber-defined Werte passieren (Check ist === undefined, nicht falsy)", () => {
    // Würde hier ein falsy-Check stehen, bräche ein numerischer Key mit Wert 0
    // oder ein leerer-String-Default. requireNonEmpty ist der strengere Helfer.
    expect(requireDefined(0, "f", "n")).toBe(0);
    expect(requireDefined("", "f", "n")).toBe("");
    expect(requireDefined(false, "f", "n")).toBe(false);
    expect(requireDefined(null, "f", "n")).toBeNull();
  });

  test("Objekt-Wert → identische Referenz zurück (generischer Typ erhalten)", () => {
    const cfg = { host: "smtp.example.com", port: 587 };
    expect(requireDefined(cfg, "mail-foundation", "smtp")).toBe(cfg);
  });
});

describe("requireNonEmpty", () => {
  test("undefined → wirft die requireDefined-Message (delegiert, NICHT empty-Pfad)", () => {
    expect(() => requireNonEmpty(undefined, "mail-foundation", "host")).toThrow(
      "config key resolved to undefined",
    );
  });

  test("leerer String → wirft empty-Message mit Default-uiHint", () => {
    expect(() => requireNonEmpty("", "file-foundation", "bucket")).toThrow(
      "file-foundation: 'bucket' is empty — tenant must configure it before use. Set via tenant-admin UI or seed-handler.",
    );
  });

  test("leerer String → wirft UnconfiguredError (422, code unconfigured, typed details)", () => {
    try {
      requireNonEmpty("", "file-foundation", "bucket");
      throw new Error("expected requireNonEmpty to throw");
    } catch (err) {
      if (!(err instanceof UnconfiguredError)) throw err;
      expect(err.code).toBe("unconfigured");
      expect(err.httpStatus).toBe(422);
      expect(err.details).toMatchObject({ feature: "file-foundation", key: "bucket" });
    }
  });

  test("leerer String mit custom uiHint → Hint landet in der Message", () => {
    expect(() =>
      requireNonEmpty("", "ai-foundation", "model", "Choose a model in Settings → AI."),
    ).toThrow("is empty — tenant must configure it before use. Choose a model in Settings → AI.");
  });

  test("non-empty Wert → unverändert zurück", () => {
    expect(requireNonEmpty("smtp.example.com", "mail-foundation", "host")).toBe("smtp.example.com");
  });

  test("reiner Whitespace → wirft empty-Message (getrimmt, gilt als leer)", () => {
    expect(() => requireNonEmpty("   ", "mail-foundation", "host")).toThrow(
      "mail-foundation: 'host' is empty — tenant must configure it before use.",
    );
  });

  test("umgebender Whitespace wird vom Rückgabewert getrimmt", () => {
    expect(requireNonEmpty("  smtp.example.com  ", "mail-foundation", "host")).toBe(
      "smtp.example.com",
    );
  });
});
