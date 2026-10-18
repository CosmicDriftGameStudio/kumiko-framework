import { describe, expect, test } from "bun:test";
import { germanBundleFor, localeDeFormalOverrides } from "../formal";
import { localeDeBundle } from "../strings";
import { localeDeClient } from "../web";

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

// \b only matches at an ASCII-word-char boundary, so "du"/"dir"/"dein..."
// only hits whole words (not substrings like "Modul" or "administrieren");
// dein\w* also catches inflected forms (deiner, deinem, deines, ...).
const duFormRegex = /\b(du|dich|dir|dein\w*|Du|Dich|Dir|Dein\w*)\b/;

// Informal imperatives carry no pronoun, so duFormRegex misses them. Only
// sentence-initial verbs are checked; formal forms (verb followed by "Sie") don't match
// because the regex requires the bare imperative followed by a non-letter.
const informalImperativeRegex =
  /(^|[.!?]\s+)(Gib|Wähle|Speichere|Klicke|Bestätige|Fordere|Scanne|Kopiere|Lege|Melde|Versuche|Prüfe|Öffne|Setze|Trage|Nutze|Verwende|Wende)(?![\p{L}])/u;

// Designer strings are du in the default bundle; extend the allowlist only for
// genuine 3rd-person "Sie" referring to a noun.
const formalAddressRegex =
  /\b(Ihr\w*|Ihnen|(Speichern|Nutzen|Laden|Wählen|Geben|Verwenden|Klicken|Prüfen|Legen|Fügen|Löschen|Bestätigen|Verwerfen|Bearbeiten|Öffnen|Setzen|Ziehen|Versuchen) Sie|Sie (sehen|können|müssen|haben|sind|werden|wollen|möchten|erhalten|benötigen))\b/;

const DESIGNER_FORMAL_ALLOWLIST: ReadonlySet<string> = new Set<string>();

describe("locale-de formal overrides", () => {
  test("informal bundle has no formal address in documentDesigner keys", () => {
    const offenders = Object.entries(localeDeBundle)
      .filter(([key]) => key.startsWith("documentDesigner."))
      .filter(
        ([key, value]) => !DESIGNER_FORMAL_ALLOWLIST.has(key) && formalAddressRegex.test(value),
      )
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  test("every override key exists in localeDeBundle", () => {
    const orphaned = Object.keys(localeDeFormalOverrides).filter(
      (k) => localeDeBundle[k] === undefined,
    );
    expect(orphaned).toEqual([]);
  });

  test("override placeholders match the original", () => {
    for (const [key, value] of Object.entries(localeDeFormalOverrides)) {
      expect(placeholders(value)).toEqual(placeholders(localeDeBundle[key] ?? ""));
    }
  });

  test("formal bundle contains no informal (du) forms", () => {
    const formalBundle = germanBundleFor("formal");
    const offenders = Object.entries(formalBundle)
      .filter(([, value]) => duFormRegex.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  test("formal bundle contains no pronoun-less informal imperatives", () => {
    const formalBundle = germanBundleFor("formal");
    const offenders = Object.entries(formalBundle)
      .filter(([, value]) => informalImperativeRegex.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  test("informal bundle is unchanged and still uses du forms", () => {
    const informalBundle = germanBundleFor("informal");
    expect(informalBundle).toBe(localeDeBundle);
    expect(informalBundle["auth.resetPassword.intro"]).toBe(
      "Wähle ein neues Passwort mit mindestens 8 Zeichen.",
    );
  });

  test("localeDeClient always ships the formal overrides under de-x-formal", () => {
    for (const address of ["informal", "formal"] as const) {
      const formal = localeDeClient({ address }).translations["de-x-formal"];
      expect(formal["auth.resetPassword.intro"]).toBe(
        localeDeFormalOverrides["auth.resetPassword.intro"],
      );
    }
  });

  test("localeDeClient defaults to informal and switches to formal on request", () => {
    expect(localeDeClient().translations["de"]["auth.resetPassword.intro"]).toBe(
      "Wähle ein neues Passwort mit mindestens 8 Zeichen.",
    );
    expect(
      localeDeClient({ address: "formal" }).translations["de"]["auth.resetPassword.intro"],
    ).toBe("Wählen Sie ein neues Passwort mit mindestens 8 Zeichen.");
  });
});
