const IBAN_SHAPE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
const MOD_97_RESIDUE = 1;

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

// Digit-wise reduction keeps every intermediate below 2^31, so no BigInt is needed for up to 34 characters.
export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!IBAN_SHAPE.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = char >= "A" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === MOD_97_RESIDUE;
}
