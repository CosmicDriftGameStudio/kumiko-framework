// Only digits and a leading "+" survive into the tel: href, so a stored
// "+49 (30) 123-45" dials but can never smuggle other URI parts.
export function telHref(value: string): string | undefined {
  const digits = value.replace(/[^\d]/g, "");
  if (digits === "") return undefined;
  return `tel:${value.trim().startsWith("+") ? "+" : ""}${digits}`;
}
