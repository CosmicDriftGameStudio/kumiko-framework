function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

// Mail clients often show only the display name: an embedded address ("<", ">", "@") would
// pass for a foreign sender on the sending domain's own SPF/DKIM-signed mail.
function isUnsafeDisplayNameCharacter(char: string): boolean {
  return isControlCharacter(char) || char === "<" || char === ">" || char === "@";
}

// Control characters in a display name would let a caller inject headers.
export function sanitizeMailDisplayName(name: string | undefined): string | undefined {
  const cleaned = name
    ?.split("")
    .map((char) => (isUnsafeDisplayNameCharacter(char) ? " " : char))
    .join("")
    .trim();
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}
