// Shared SQL helpers for locating a subject's PII ciphertext by its inline
// subject-key prefix (kumiko-pii:v<version>:<subjectKey>:...). Used by both
// the blind-index sweep (db/blind-index-cleanup.ts) and the search-index
// purge (search/purge-subject.ts) — the two sweeps must stay in lockstep
// across ciphertext format versions.

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// "v%" matches any format version (v1 no-AAD, v2 AAD-bound, #1263) — the
// subject key placement is stable across versions.
export function subjectCiphertextLikePattern(subjectKey: string): string {
  return `kumiko-pii:v%:${escapeLikePattern(subjectKey)}:%`;
}
