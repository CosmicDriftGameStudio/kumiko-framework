export type ParsedSenderAddress = { readonly label: string; readonly email: string };

// A value without "@" yields nothing: a contact whose e-mail is not an address is worse than none.
export function parseSenderAddress(from: string): ParsedSenderAddress | undefined {
  const angled = splitAngleAddress(from);
  const email = (angled?.address ?? from).trim();
  if (!email.includes("@")) return undefined;
  const label = angled?.label.replace(/^"|"$/g, "").trim();
  return { label: label && label.length > 0 ? label : email, email };
}

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

// Linear scan instead of a lazy-label regex, which backtracks cubically on long whitespace runs.
function splitAngleAddress(from: string): { label: string; address: string } | undefined {
  const value = from.trim();
  const last = value.length - 1;
  if (last < 2 || value[last] !== ">") return undefined;
  const open = value.indexOf("<", value.lastIndexOf(">", last - 1) + 1);
  if (open === -1 || open >= last - 1) return undefined;
  const label = value.slice(0, open).trimEnd();
  if (LINE_TERMINATOR.test(label)) return undefined;
  return { label, address: value.slice(open + 1, last) };
}
