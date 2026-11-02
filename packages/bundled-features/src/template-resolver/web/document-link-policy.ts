import { isDocumentReferenceName } from "./document-reference-name.ts";

const PLACEHOLDER_HREF = /^\{\{(.+)\}\}$/;
const ALLOWED_LINK_SCHEMES = ["https://", "http://", "mailto:", "tel:"] as const;

export function isDocumentPlaceholderHref(href: string): boolean {
  const name = PLACEHOLDER_HREF.exec(href)?.[1];
  return name !== undefined && isDocumentReferenceName(name);
}

const UNSAFE_URL_CHARACTERS = new Set(["<", ">", '"']);

function hasUnsafeUrlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return UNSAFE_URL_CHARACTERS.has(character) || code <= 0x1f || code === 0x7f;
  });
}

function isParsableWebUrl(href: string, protocol: "https:" | "http:"): boolean {
  try {
    return new URL(href).protocol === protocol;
  } catch {
    return false;
  }
}

function hasAllowedLinkScheme(href: string): boolean {
  if (href.startsWith("https://")) return isParsableWebUrl(href, "https:");
  if (href.startsWith("http://")) return isParsableWebUrl(href, "http:");
  return ALLOWED_LINK_SCHEMES.some((scheme) => href.startsWith(scheme));
}

// Relative references are matched by their literal leading character so a
// scheme can never hide in them: a value starting with a letter ("x:y",
// "javascript:") is not relative. Protocol-relative "//host" and any backslash
// (browsers read "/\\host" as "//host") would leave the site.
const RELATIVE_HREF_PREFIXES = ["/", "./", "../", "#", "?"] as const;

function isRelativeHref(href: string): boolean {
  if (href.includes("\\") || href.startsWith("//")) return false;
  return RELATIVE_HREF_PREFIXES.some((prefix) => href.startsWith(prefix));
}

// Exact lowercase prefix on the unchanged value: no trim, no case folding, so
// "JaVaScRiPt:", "HTTPS://" or a leading tab can never slip through as a
// scheme variant. Markup and control characters are refused outright because
// downstream parsers (MJML, PDF renderer) re-read the serialized attribute.
export function isAllowedDocumentUrlHref(href: string): boolean {
  if (hasUnsafeUrlCharacter(href)) return false;
  return hasAllowedLinkScheme(href) || isDocumentPlaceholderHref(href);
}

// Anchors only: other URL attributes (form action, svg href) resolve against the
// page and must stay on explicit schemes or placeholders.
export function isAllowedDocumentLinkHref(href: string): boolean {
  return isAllowedDocumentUrlHref(href) || (!hasUnsafeUrlCharacter(href) && isRelativeHref(href));
}
