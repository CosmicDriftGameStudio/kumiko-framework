// "jpg" → ".jpg", "image/png" stays as-is. Empty list → no accept attribute.
export function toAcceptAttr(accept?: readonly string[]): string | undefined {
  if (accept === undefined || accept.length === 0) return undefined;
  return accept.map((a) => (a.startsWith(".") || a.includes("/") ? a : `.${a}`)).join(",");
}
