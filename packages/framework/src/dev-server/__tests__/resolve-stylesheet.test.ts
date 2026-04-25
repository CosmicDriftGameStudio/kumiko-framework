// Unit-Tests für resolveStylesheet — die vier Verzweigungen aus
// createKumikoServer's CSS-Setup. Läuft unter vitest auf Node, also
// ohne Bun.serve und ohne Bun.resolveSync; der Default-Resolution-
// Pfad (Bun-only) ist hier explizit als "skip silent" abgedeckt.
//
// Warum als eigener File statt im create-kumiko-server.integration.ts:
// die anderen Tests dort booten ein TestStack (DB + Redis), das brauchen
// wir für reine Resolver-Logik nicht.

import { describe, expect, test } from "vitest";
import { resolveStylesheet } from "../create-kumiko-server";

describe("resolveStylesheet", () => {
  test("string → resolved absolute path", () => {
    // Relativ zum CWD aufgelöst — das ist Node's path.resolve-Default.
    const out = resolveStylesheet({
      features: [],
      stylesheet: "./some/stylesheet.css",
    });
    expect(out).toMatch(/\/some\/stylesheet\.css$/);
    expect(out?.startsWith("/")).toBe(true);
  });

  test("absolute string bleibt unverändert (path.resolve idempotent)", () => {
    const out = resolveStylesheet({
      features: [],
      stylesheet: "/abs/path/styles.css",
    });
    expect(out).toBe("/abs/path/styles.css");
  });

  test("false → undefined (Pipeline explizit aus)", () => {
    const out = resolveStylesheet({
      features: [],
      stylesheet: false,
      clientEntry: "./entry.tsx",
    });
    expect(out).toBeUndefined();
  });

  test("undefined ohne clientEntry → undefined (kein Browser-Bundle, keine CSS)", () => {
    const out = resolveStylesheet({
      features: [],
    });
    expect(out).toBeUndefined();
  });

  test("undefined + clientEntry unter Node (ohne Bun): undefined (silent skip)", () => {
    // hasBun ist false in vitest-Node — Default-Resolution wird übersprungen,
    // ohne Throw. Wer im Test eine echte CSS will, übergibt explicit string.
    // Unter Bun (production) würde Bun.resolveSync den Path liefern; das
    // testet der bestehende create-kumiko-server.integration.ts.
    const out = resolveStylesheet({
      features: [],
      clientEntry: "./entry.tsx",
    });
    expect(out).toBeUndefined();
  });
});
