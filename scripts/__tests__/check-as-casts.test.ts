// Unit-Tests für die Audit-Heuristiken in check-as-casts.ts.
//
// Synthetische TS-Sources mit ts-morph parsen, dann pro AsExpression die
// Kategorie und (wenn vorhanden) den Boundary-Reason prüfen. Das deckt:
//   - alle 7 Kategorien (legit-* + suspect-*)
//   - die Bridge-Erkennung (`x as unknown as Y`)
//   - die @cast-boundary-Marker-Heuristik (leading, trailing, multi-line)
//   - Reason-Extraktion
//
// Vor diesem Test war hasBoundaryMarker eine String-Line-Heuristik die in
// 9% der Fälle Marker übersehen hat.

import { describe, expect, test } from "vitest";
import { type AsExpression, Project, SyntaxKind } from "ts-morph";
import {
  categorize,
  extractBoundaryReason,
  getFileDefaultReason,
  hasBoundaryMarker,
  isBridgeInner,
  isBridgeOuter,
  isConstAssertion,
  isKnownBoundaryReason,
  isNarrowingCast,
  isParseCast,
  isTypingLossMarkerCast,
  KNOWN_BOUNDARY_REASONS,
  looksLikeBrandConstruction,
} from "../check-as-casts";

function parseFirstCast(source: string): AsExpression {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  const sf = project.createSourceFile("test.ts", source);
  const cast = sf.getFirstDescendantByKind(SyntaxKind.AsExpression);
  if (!cast) throw new Error("no AsExpression found in source");
  return cast;
}

function parseAllCasts(source: string): AsExpression[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  const sf = project.createSourceFile("test.ts", source);
  return sf.getDescendantsOfKind(SyntaxKind.AsExpression);
}

describe("isConstAssertion", () => {
  test("matches `as const`", () => {
    expect(isConstAssertion(parseFirstCast(`const x = ["a"] as const;`))).toBe(true);
  });
  test("rejects `as Record<...>`", () => {
    expect(isConstAssertion(parseFirstCast(`const x = y as Record<string, unknown>;`))).toBe(false);
  });
});

describe("isBridgeInner / isBridgeOuter", () => {
  test("inner of `x as unknown as Y` → isBridgeInner=true", () => {
    const casts = parseAllCasts(`const x = (y as unknown) as { a: 1 };`);
    // ts-morph: outer first in descendants? Actually nested: outer wraps inner.
    // We want to find the inner (target=unknown).
    const inner = casts.find((c) => c.getTypeNode()?.getText() === "unknown");
    const outer = casts.find((c) => c.getTypeNode()?.getText() !== "unknown");
    expect(inner).toBeDefined();
    expect(outer).toBeDefined();
    expect(isBridgeInner(inner as AsExpression)).toBe(true);
    expect(isBridgeOuter(outer as AsExpression)).toBe(true);
  });
  test("plain `x as unknown` (no outer) → isBridgeInner=false", () => {
    expect(isBridgeInner(parseFirstCast(`const x = y as unknown;`))).toBe(false);
  });
});

describe("looksLikeBrandConstruction", () => {
  test('"abc" as TenantId → true', () => {
    expect(looksLikeBrandConstruction(parseFirstCast(`const x = "abc" as TenantId;`))).toBe(true);
  });
  test('"abc" as MyEntityKey → true', () => {
    expect(looksLikeBrandConstruction(parseFirstCast(`const x = "abc" as MyEntityKey;`))).toBe(true);
  });
  test('"abc" as Record<string, unknown> → false', () => {
    expect(
      looksLikeBrandConstruction(parseFirstCast(`const x = "abc" as Record<string, unknown>;`)),
    ).toBe(false);
  });

  test("`row.tenantId as TenantId` → true (PropertyAccess + name-match)", () => {
    expect(looksLikeBrandConstruction(parseFirstCast(`const x = row.tenantId as TenantId;`))).toBe(
      true,
    );
  });
  test("`obj.userId as UserId` → true (camelCase ↔ PascalCase match)", () => {
    expect(looksLikeBrandConstruction(parseFirstCast(`const x = obj.userId as UserId;`))).toBe(
      true,
    );
  });
  test('`payload["tenantId"] as TenantId` → false (ElementAccess, kein typed source)', () => {
    expect(
      looksLikeBrandConstruction(parseFirstCast(`const x = payload["tenantId"] as TenantId;`)),
    ).toBe(false);
  });
  test("`row.foo as TenantId` → false (Property-Name matched Target nicht)", () => {
    expect(looksLikeBrandConstruction(parseFirstCast(`const x = row.foo as TenantId;`))).toBe(
      false,
    );
  });
  test("variable as TenantId → false (source not literal)", () => {
    expect(looksLikeBrandConstruction(parseFirstCast(`const x = y as TenantId;`))).toBe(false);
  });
});

describe("isParseCast", () => {
  test("JSON.parse(...) as X → true", () => {
    expect(
      isParseCast(parseFirstCast(`const x = JSON.parse(raw) as Record<string, unknown>;`)),
    ).toBe(true);
  });
  test("zSchema.parse(...) as X → true (Zod-Pattern)", () => {
    expect(isParseCast(parseFirstCast(`const x = userSchema.parse(raw) as User;`))).toBe(true);
    expect(
      isParseCast(parseFirstCast(`const x = userSchema.safeParse(raw) as SafeParseResult;`)),
    ).toBe(true);
  });
  test("parseJsonSafe / parseJsonOrThrow → true", () => {
    expect(isParseCast(parseFirstCast(`const x = parseJsonSafe(raw) as Foo;`))).toBe(true);
    expect(isParseCast(parseFirstCast(`const x = parseJsonOrThrow(raw) as Foo;`))).toBe(true);
  });
  test("myArray.parse() (custom helper) → false (kein Zod-Schema-Pattern)", () => {
    // Vorher matchte alles auf `.parse` blanket. Jetzt enger:
    // nur Zod-Schema-Pattern + bekannte JSON-Helper.
    expect(isParseCast(parseFirstCast(`const x = myArray.parse() as Foo;`))).toBe(false);
  });
  test("identifier cast → false", () => {
    expect(isParseCast(parseFirstCast(`const x = y as Record<string, unknown>;`))).toBe(false);
  });
});

describe("isNarrowingCast", () => {
  test("variable cast → true", () => {
    expect(isNarrowingCast(parseFirstCast(`const x = y as Foo;`))).toBe(true);
  });
  test("property-access cast → false", () => {
    expect(isNarrowingCast(parseFirstCast(`const x = obj.field as Foo;`))).toBe(false);
  });
});

describe("hasBoundaryMarker / extractBoundaryReason", () => {
  test("trailing same-line marker → recognized + reason extracted", () => {
    const cast = parseFirstCast(
      `const x = y as Record<string, unknown>; // @cast-boundary engine-payload`,
    );
    expect(hasBoundaryMarker(cast)).toBe(true);
    expect(extractBoundaryReason(cast)).toBe("engine-payload");
  });

  test("leading line-comment → recognized", () => {
    const cast = parseFirstCast(
      `// @cast-boundary form-values\nconst x = y as Record<string, unknown>;`,
    );
    expect(hasBoundaryMarker(cast)).toBe(true);
    expect(extractBoundaryReason(cast)).toBe("form-values");
  });

  test("leading block-comment → recognized", () => {
    const cast = parseFirstCast(
      `/* @cast-boundary zod-issue */\nconst x = y as Record<string, unknown>;`,
    );
    expect(hasBoundaryMarker(cast)).toBe(true);
    expect(extractBoundaryReason(cast)).toBe("zod-issue");
  });

  test("multi-line cast with inline marker → recognized", () => {
    const source = `const x = (
      complexExpression
    ) as Record<
      string,
      unknown
    >; // @cast-boundary engine-payload`;
    const cast = parseFirstCast(source);
    expect(hasBoundaryMarker(cast)).toBe(true);
    expect(extractBoundaryReason(cast)).toBe("engine-payload");
  });

  test("two casts in same statement, both share trailing marker → both recognized", () => {
    const source = `const x = (a as Record<string, unknown>)["k"] as string; // @cast-boundary engine-payload`;
    const casts = parseAllCasts(source);
    expect(casts).toHaveLength(2);
    expect(casts.every(hasBoundaryMarker)).toBe(true);
  });

  test("no marker → null reason / false", () => {
    const cast = parseFirstCast(`const x = y as Record<string, unknown>;`);
    expect(hasBoundaryMarker(cast)).toBe(false);
    expect(extractBoundaryReason(cast)).toBeNull();
  });

  test("marker without reason → empty string reason", () => {
    const cast = parseFirstCast(`const x = y as Record<string, unknown>; // @cast-boundary`);
    expect(hasBoundaryMarker(cast)).toBe(true);
    expect(extractBoundaryReason(cast)).toBe("");
  });

  test("cast in function-argument position with statement-trailing marker → recognized", () => {
    // Branch 4 in extractBoundaryReason: Cast steht innerhalb eines
    // Function-Calls, NICHT am Statement-Ende. Trailing-Comment am
    // Statement-Ende muss trotzdem als Marker erkannt werden.
    const cast = parseFirstCast(
      `func(x as Record<string, unknown>, otherArg); // @cast-boundary engine-payload`,
    );
    expect(hasBoundaryMarker(cast)).toBe(true);
    expect(extractBoundaryReason(cast)).toBe("engine-payload");
  });

  test("unrelated comment with @cast-boundary in different statement → not recognized", () => {
    // Marker auf Statement A, Cast in Statement B — Marker greift nicht
    // weil er außerhalb des Cast-Statement-Range liegt.
    const source = `const a = "hi"; // @cast-boundary engine-payload\nconst b = y as Foo;`;
    const cast = parseFirstCast(source);
    expect(hasBoundaryMarker(cast)).toBe(false);
  });
});

describe("isKnownBoundaryReason / KNOWN_BOUNDARY_REASONS", () => {
  test("anerkannte Reasons sind whitelisted", () => {
    for (const r of KNOWN_BOUNDARY_REASONS) {
      expect(isKnownBoundaryReason(r)).toBe(true);
    }
  });
  test("Tippfehler / Drift wird abgelehnt", () => {
    expect(isKnownBoundaryReason("engine_payload")).toBe(false);
    expect(isKnownBoundaryReason("enginePayload")).toBe(false);
    expect(isKnownBoundaryReason("engine payload")).toBe(false);
    expect(isKnownBoundaryReason("EnginePayload")).toBe(false);
    expect(isKnownBoundaryReason("")).toBe(false);
  });
  test("Reasons sind kebab-case ohne Duplicates", () => {
    // Strukturtest statt brittle Length-Check: jede Reason muss
    // [a-z][a-z0-9-]+ matchen und unique sein. Verhindert Drift wie
    // `enginePayload` oder duplicate `engine-payload`.
    const seen = new Set<string>();
    for (const r of KNOWN_BOUNDARY_REASONS) {
      expect(r).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(seen.has(r), `duplicate reason: ${r}`).toBe(false);
      seen.add(r);
    }
  });
});

describe("categorize (priority order)", () => {
  test("`x as const` → legit-const", () => {
    expect(categorize(parseFirstCast(`const x = [1,2] as const;`))).toBe("legit-const");
  });

  test("`x as unknown as Y` (inner) → legit-bridge", () => {
    const casts = parseAllCasts(`const x = (y as unknown) as { a: 1 };`);
    const inner = casts.find((c) => c.getTypeNode()?.getText() === "unknown");
    expect(categorize(inner as AsExpression)).toBe("legit-bridge");
  });

  test('`"abc" as TenantId` → legit-brand', () => {
    expect(categorize(parseFirstCast(`const x = "abc" as TenantId;`))).toBe("legit-brand");
  });

  test("Cast with @cast-boundary marker → legit-boundary", () => {
    const cast = parseFirstCast(
      `const x = y as Record<string, unknown>; // @cast-boundary engine-payload`,
    );
    expect(categorize(cast)).toBe("legit-boundary");
  });

  test("`JSON.parse(...) as X` → suspect-parse", () => {
    expect(categorize(parseFirstCast(`const x = JSON.parse(raw) as Foo;`))).toBe("suspect-parse");
  });

  test("`y as Foo` (variable) → suspect-narrow", () => {
    expect(categorize(parseFirstCast(`const x = y as Foo;`))).toBe("suspect-narrow");
  });

  test("`obj.field as Foo` (property access) → suspect-general", () => {
    expect(categorize(parseFirstCast(`const x = obj.field as Foo;`))).toBe("suspect-general");
  });

  test("Bridge wins over Boundary (priority)", () => {
    // Bridge-inner mit Marker — sollte als legit-bridge kategorisiert werden,
    // nicht legit-boundary. Die Order ist konstruiert: bridge ist semantisch
    // präziser als generic boundary.
    const casts = parseAllCasts(
      `const x = (y as unknown) as Record<string, unknown>; // @cast-boundary engine-payload`,
    );
    const inner = casts.find((c) => c.getTypeNode()?.getText() === "unknown");
    expect(categorize(inner as AsExpression)).toBe("legit-bridge");
  });
});

describe("getFileDefaultReason", () => {
  test("feature-ast Pfad → schema-walk", () => {
    expect(getFileDefaultReason("/abs/packages/framework/src/engine/feature-ast/extractors.ts")).toBe(
      "schema-walk",
    );
    expect(getFileDefaultReason("packages/framework/src/engine/feature-ast/walker.ts")).toBe(
      "schema-walk",
    );
  });
  test("Andere Pfade → null (kein Default)", () => {
    expect(getFileDefaultReason("packages/framework/src/pipeline/dispatcher.ts")).toBeNull();
    expect(getFileDefaultReason("packages/bundled-features/src/delivery/delivery-service.ts"))
      .toBeNull();
  });
});

describe("isTypingLossMarkerCast", () => {
  test("`row as DbRow` → true (Type IST der Marker)", () => {
    expect(isTypingLossMarkerCast(parseFirstCast(`const x = row as DbRow;`))).toBe(true);
  });
  test("`row as DbRow | undefined` → true", () => {
    expect(isTypingLossMarkerCast(parseFirstCast(`const x = row as DbRow | undefined;`))).toBe(true);
  });
  test("`row as Record<string, unknown>` → false (zu generic, braucht Reason)", () => {
    expect(isTypingLossMarkerCast(parseFirstCast(`const x = row as Record<string, unknown>;`))).toBe(
      false,
    );
  });

  test("Cast zu DbRow ohne Marker → categorize = legit-boundary", () => {
    // Ohne diese Sonder-Erkennung wäre das suspect-narrow gewesen.
    expect(categorize(parseFirstCast(`const x = row as DbRow;`))).toBe("legit-boundary");
  });
});
