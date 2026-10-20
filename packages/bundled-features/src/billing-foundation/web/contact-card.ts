/** Shared by boot validation and the panel (defense in depth); keep free of server imports. */
export function isContactCardHref(href: string): boolean {
  if (href !== href.trim()) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "mailto:" && url.pathname !== "";
}
