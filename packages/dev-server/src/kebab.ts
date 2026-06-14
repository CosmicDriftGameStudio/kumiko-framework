// Segment-strict: rejects trailing/double hyphen so the name is a valid
// package-name + folder (`my-shop`, not `my-` or `my--shop`).
const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// @wrapper-known semantic-alias
export function isKebabSegment(value: string): boolean {
  return KEBAB_RE.test(value);
}
