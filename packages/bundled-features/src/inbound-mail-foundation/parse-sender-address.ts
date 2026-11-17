export type ParsedSenderAddress = { readonly label: string; readonly email: string };

// A value without "@" yields nothing: a contact whose e-mail is not an address is worse than none.
export function parseSenderAddress(from: string): ParsedSenderAddress | undefined {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  const email = (angled?.[2] ?? from).trim();
  if (!email.includes("@")) return undefined;
  const label = angled?.[1]?.replace(/^"|"$/g, "").trim();
  return { label: label && label.length > 0 ? label : email, email };
}
