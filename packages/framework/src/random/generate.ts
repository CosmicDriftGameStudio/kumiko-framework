// Random generator for human-readable resource identifiers:
//   - Tenant keys ("happy-cloud", "swift-river-k8x")
//   - Webhook subscriber slugs ("bold-falcon-receiver" with custom nouns)
//   - API key display names (offer 3 suggestions on creation)
//   - Tenant subdomain suggestions in the subdomain setup screen
//   - Test fixtures with readable identifiers
//
// NOT for security tokens (CSRF, session, API keys, OAuth state,
// reset tokens). Math.random() is not cryptographically unpredictable.
// Authority binding for tenant keys uses JWT + DB lookup, not slug secrecy;
// the slug may be guessable.
//
// Safe across environments: Math.random() runs in Bun, Node, Metro/RN, and
// Expo Web. No node:crypto imports.

import { ADJECTIVES, NOUNS } from "./words.ts";

// Alphabet without characters that are easily confused when entered manually:
//   - no 0/O (zero versus uppercase O)
//   - no 1/l/I (one versus lowercase L versus uppercase I)
// Result: 32 characters, safe for spelling over the phone AND for copying
// from email text in unfamiliar fonts.
const NO_CONFUSABLE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const NO_CONFUSABLE_CHARS: readonly string[] = Object.freeze(NO_CONFUSABLE_ALPHABET.split(""));

function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) {
    throw new Error("pickRandom: cannot pick from empty array");
  }
  const value = arr[Math.floor(Math.random() * arr.length)];
  // The length check above guarantees that the index is in range.
  if (value === undefined) {
    throw new Error("pickRandom: indexed value undefined (sparse array?)");
  }
  return value;
}

export type AdjNounNameOptions = {
  /** Separator between adj/noun (and, if applicable, suffix). Default "-". */
  readonly separator?: string;
  /** If set, appends a random suffix of length .length
   *  (no-confusable alphabet). 3 characters are recommended = 32^3 = 32,768
   *  additional combinations per word pair. */
  readonly suffix?: { readonly length: number };
  /** Custom Adjective-Liste — default ADJECTIVES (191 generic). */
  readonly adjectives?: readonly string[];
  /** Custom noun list — default NOUNS (173 generic). Apps that want
   *  domain-specific slugs (e.g. webhook features with their own
   *  -receiver/-listener nouns) provide their own list. */
  readonly nouns?: readonly string[];
};

/** Sync generator: produces "happy-cloud" or "happy-cloud-k8x"
 *  (with suffix). No conflict check — the caller is responsible for
 *  uniqueness, or can use generateUniqueName() for the async variant. */
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

/** Random string from the no-confusable alphabet. For suffixes after
 *  collisions or as standalone short IDs (e.g. webhook verification codes
 *  to be read aloud over the phone). length ≥ 1. */
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
  /** Caller predicate. Returns true if the name is not yet assigned
   *  (typically: DB query "select where slug=$1" → row count === 0). */
  readonly isAvailable: (name: string) => Promise<boolean>;
  /** Maximum attempts WITHOUT a suffix before switching to suffix mode.
   *  Default 3. With 33,043 default combinations and ~150 existing
   *  tenants, p(collision) < 1% — 3 attempts are more than sufficient. */
  readonly maxCleanAttempts?: number;
  /** Suffix length in collision mode. Default 3 (= 32,768 combinations
   *  per word pair). */
  readonly suffixLength?: number;
  /** Hard cap on total attempts before giving up. Default 20.
   *  Rarely reached in practice — if it is, the word list may be empty or
   *  isAvailable() may return false consistently (DB bug). */
  readonly maxTotalAttempts?: number;
  readonly separator?: string;
  readonly adjectives?: readonly string[];
  readonly nouns?: readonly string[];
};

/** Generates a unique Adj-Noun slug by trying up to maxCleanAttempts
 *  clean word pairs, then using a random suffix up to maxTotal-
 *  Attempts. Throws if that also fails (= the caller has a bug
 *  in isAvailable, or the word list is defective).
 *
 *  Example:
 *    const slug = await generateUniqueName({
 *      isAvailable: async (s) =>
 *        !(await db.select().from(tenants).where(eq(tenants.tenantKey, s)).then(r => r.length > 0)),
 *    });
 *    // → "happy-cloud" or "happy-cloud-k8x" on collision
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
