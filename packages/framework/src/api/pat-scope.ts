// QN scope-matching for Personal Access Tokens. A token's granted scopes
// expand (in the PAT feature's resolver) to QN globs like "credit:write:*" or
// "credit:query:credit:list". A glob ending in "*" matches any dispatch type
// sharing the prefix; otherwise it is an exact match. Fail-closed: an empty
// allow-list matches nothing, so a PAT with no scopes can call nothing.

export function qnMatches(pattern: string, type: string): boolean {
  if (pattern.endsWith("*")) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

export function patAllows(allowedQns: readonly string[], type: string): boolean {
  return allowedQns.some((pattern) => qnMatches(pattern, type));
}
