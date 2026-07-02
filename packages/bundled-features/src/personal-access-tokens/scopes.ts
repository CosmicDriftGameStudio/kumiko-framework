// @runtime client
// Pure scope helpers + types — client-marked so the web screen (web/) may import
// parseGrant without pulling the feature's server runtime barrel.
//
// App-declared scopes — two axes, like GitHub fine-grained PATs: WHICH API
// (the domain, keyed here) × the permission LEVEL (read vs read+write). Each
// domain declares its read-QN globs and (optionally) its write-QN globs. A
// domain may span features (e.g. a "miete" domain granting ledger + folders).
export type PatScopeDef = {
  readonly label: string;
  readonly read: readonly string[];
  // Omit for a read-only domain — the UI then offers only "no access" / "read".
  readonly write?: readonly string[];
};

export type PatScopeConfig = Readonly<Record<string, PatScopeDef>>;

export type PatLevel = "read" | "write";

// A granted scope is the string "<domain>:<level>" (e.g. "credit:write"). The
// domain key never contains a colon, so split on the LAST one.
export function parseGrant(grant: string): { domain: string; level: string } | null {
  const idx = grant.lastIndexOf(":");
  if (idx <= 0) return null;
  return { domain: grant.slice(0, idx), level: grant.slice(idx + 1) };
}

// Expand granted "<domain>:<level>" entries into the union of QN globs: read
// always grants the read QNs; write additionally grants the write QNs. Unknown
// domains contribute nothing (fail-closed — a scope dropped from config after a
// token was minted silently loses that capability).
export function expandScopes(config: PatScopeConfig, granted: readonly string[]): string[] {
  const out = new Set<string>();
  for (const grant of granted) {
    const parsed = parseGrant(grant);
    if (!parsed) continue;
    const def = config[parsed.domain];
    if (!def) continue;
    for (const q of def.read) out.add(q);
    if (parsed.level === "write") for (const q of def.write ?? []) out.add(q);
  }
  return [...out];
}
