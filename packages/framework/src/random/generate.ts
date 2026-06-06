// Random-Generator für human-readable Resource-Identifier:
//   - Tenant-Keys ("happy-cloud", "swift-river-k8x")
//   - Webhook-Subscriber-Slugs ("bold-falcon-receiver" mit custom nouns)
//   - API-Key-Display-Names (3 Vorschläge anbieten beim Create)
//   - Tenant-Subdomain-Vorschläge im Subdomain-Setup-Screen
//   - Test-Fixtures mit lesbaren Identifiern
//
// NICHT für Security-Token (CSRF, Session, API-Keys, OAuth-State,
// Reset-Token). Math.random() ist nicht kryptografisch unvorhersagbar.
// Authority-binding für Tenant-Keys läuft über JWT + DB-Lookup, nicht
// über Slug-Geheimhaltung — der Slug darf erratbar sein.
//
// Universal-safe: Math.random() läuft in Bun, Node, Metro/RN, Expo-Web.
// Keine node:crypto-Imports.

import { ADJECTIVES, NOUNS } from "./words";

// Alphabet ohne handgetippt verwechselbare Zeichen:
//   - keine 0/O (Null vs Großbuchstabe O)
//   - keine 1/l/I (Eins vs Kleinbuchstabe L vs Großbuchstabe I)
// Resultat: 32 Zeichen, sicher beim Telefon-Buchstabieren UND beim
// Mailtext-Copy-Paste in fremde Schriftarten.
const NO_CONFUSABLE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const NO_CONFUSABLE_CHARS: readonly string[] = Object.freeze(NO_CONFUSABLE_ALPHABET.split(""));

function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error("pickRandom: cannot pick from empty array");
  }
  const value = arr[Math.floor(Math.random() * arr.length)];
  // Length-Check oben garantiert dass index in-range ist.
  if (value === undefined) {
    throw new Error("pickRandom: indexed value undefined (sparse array?)");
  }
  return value;
}

export type AdjNounNameOptions = {
  /** Trennzeichen zwischen adj/noun (und ggf. suffix). Default "-". */
  readonly separator?: string;
  /** Wenn gesetzt, wird ein random-suffix der Länge .length angehängt
   *  (no-confusable-Alphabet). Empfohlen 3 Zeichen = 32^3 = 32.768
   *  zusätzliche Combinations pro Wortpaar. */
  readonly suffix?: { readonly length: number };
  /** Custom Adjective-Liste — default ADJECTIVES (191 generic). */
  readonly adjectives?: readonly string[];
  /** Custom Noun-Liste — default NOUNS (173 generic). Apps die Domain-
   *  spezifische Slugs wollen (z.B. webhook-feature mit eigenen
   *  -receiver/-listener-Substantiven) reichen ihre eigene Liste. */
  readonly nouns?: readonly string[];
};

/** Sync Generator: produziert "happy-cloud" oder "happy-cloud-k8x"
 *  (mit suffix). Kein Conflict-Check — Caller verantwortlich für
 *  Uniqueness, oder generateUniqueName() für die async Variante. */
export function generateAdjNounName(options: AdjNounNameOptions = {}): string {
  const sep = options.separator ?? "-";
  const adjs = options.adjectives ?? ADJECTIVES;
  const nouns = options.nouns ?? NOUNS;
  let name = `${pickRandom(adjs)}${sep}${pickRandom(nouns)}`;
  if (options.suffix) {
    name = `${name}${sep}${generateNoConfusableId(options.suffix.length)}`;
  }
  return name;
}

/** Random-String aus dem no-confusable-Alphabet. Für Suffix-bei-Kollision
 *  oder als standalone short-IDs (z.B. Webhook-Verifizierungs-Codes
 *  zum Vorlesen am Telefon). length ≥ 1. */
export function generateNoConfusableId(length: number): string {
  if (length < 1) {
    throw new Error(`generateNoConfusableId: length must be ≥ 1 (got ${length})`);
  }
  let id = "";
  for (let i = 0; i < length; i++) {
    id += pickRandom(NO_CONFUSABLE_CHARS);
  }
  return id;
}

export type GenerateUniqueNameOptions = {
  /** Caller-Predicate. Returns true wenn der Name noch nicht vergeben
   *  ist (typisch: DB-Query "select where slug=$1" → row count === 0). */
  readonly isAvailable: (name: string) => Promise<boolean>;
  /** Max Versuche OHNE Suffix bevor wir auf suffix-mode wechseln.
   *  Default 3. Bei 33.043 Default-Combos und ~150 existierenden
   *  Tenants liegt p(Kollision) < 1% — 3 Versuche reichen weit. */
  readonly maxCleanAttempts?: number;
  /** Suffix-Länge bei Kollision-Mode. Default 3 (= 32.768 Combinations
   *  pro Wortpaar). */
  readonly suffixLength?: number;
  /** Hard-Cap an Total-Versuchen bevor wir aufgeben. Default 20.
   *  Praktisch nie erreicht — wenn doch, ist die Wortliste leer oder
   *  isAvailable() returnt durchgängig false (DB-Bug). */
  readonly maxTotalAttempts?: number;
  readonly separator?: string;
  readonly adjectives?: readonly string[];
  readonly nouns?: readonly string[];
};

/** Generiert einen unique Adj-Noun-Slug indem es bis zu maxCleanAttempts
 *  saubere Wortpaare versucht, danach mit random Suffix bis maxTotal-
 *  Attempts. Wirft wenn auch das nicht hilft (= caller hat ein Bug
 *  mit isAvailable, oder die Wortliste ist defekt).
 *
 *  Beispiel:
 *    const slug = await generateUniqueName({
 *      isAvailable: async (s) =>
 *        !(await db.select().from(tenants).where(eq(tenants.tenantKey, s)).then(r => r.length > 0)),
 *    });
 *    // → "happy-cloud" oder "happy-cloud-k8x" bei Kollision
 */
export async function generateUniqueName(options: GenerateUniqueNameOptions): Promise<string> {
  const maxClean = options.maxCleanAttempts ?? 3;
  const suffixLength = options.suffixLength ?? 3;
  const maxTotal = options.maxTotalAttempts ?? 20;
  if (maxClean > maxTotal) {
    throw new Error(
      `generateUniqueName: maxCleanAttempts (${maxClean}) must not exceed maxTotalAttempts (${maxTotal})`,
    );
  }

  const baseOptions: AdjNounNameOptions = {
    ...(options.separator !== undefined && { separator: options.separator }),
    ...(options.adjectives !== undefined && { adjectives: options.adjectives }),
    ...(options.nouns !== undefined && { nouns: options.nouns }),
  };

  for (let i = 0; i < maxTotal; i++) {
    const useSuffix = i >= maxClean;
    const name = generateAdjNounName(
      useSuffix ? { ...baseOptions, suffix: { length: suffixLength } } : baseOptions,
    );
    if (await options.isAvailable(name)) return name;
  }

  throw new Error(
    `generateUniqueName: failed to find available name after ${maxTotal} attempts. ` +
      `Wordlists may be exhausted, or isAvailable() returns false unconditionally.`,
  );
}
