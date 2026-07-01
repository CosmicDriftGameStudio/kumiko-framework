// App-declared scopes. Each scope is a named bundle of QN globs the app author
// wires when mounting the feature — a scope may span features (e.g. a "miete"
// scope granting ledger + folders QNs). The token stores granted scope NAMES;
// the resolver expands them to globs at request time.
export type PatScopeDef = {
  readonly label: string;
  readonly qns: readonly string[];
};

export type PatScopeConfig = Readonly<Record<string, PatScopeDef>>;

// Expand granted scope names into the union of their QN globs. Unknown names
// (scope dropped from config after a token was minted) contribute nothing —
// fail-closed: the token silently loses that capability rather than erroring.
export function expandScopes(config: PatScopeConfig, granted: readonly string[]): string[] {
  const out = new Set<string>();
  for (const name of granted) {
    const def = config[name];
    if (def) for (const qn of def.qns) out.add(qn);
  }
  return [...out];
}
