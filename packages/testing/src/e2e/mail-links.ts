import type { CapturedMail } from "./seed-contract";

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

// The mail renderer entity-encodes attribute values (`=` arrives as `&#x3D;`).
// One pass, so an encoded "&amp;#x3D;" stays the literal text "&#x3D;".
export function decodeHtmlAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

export function mailLinks(mail: Pick<CapturedMail, "html">): readonly string[] {
  return [...mail.html.matchAll(/href="([^"]+)"/g)].map((match) =>
    decodeHtmlAttribute(match[1] ?? ""),
  );
}

export function extractMailLink(
  mail: Pick<CapturedMail, "html" | "to">,
  pathFragment: string,
): string {
  const link = mailLinks(mail).find((href) => href.includes(pathFragment));
  if (link === undefined) {
    throw new Error(`No link containing "${pathFragment}" found in mail to ${mail.to}`);
  }
  return link;
}

export function extractMailLinkToken(
  mail: Pick<CapturedMail, "html" | "to">,
  pathFragment: string,
  param = "token",
): string {
  const token = new URL(extractMailLink(mail, pathFragment)).searchParams.get(param);
  if (!token) {
    throw new Error(`Link "${pathFragment}" in mail to ${mail.to} carries no "${param}" parameter`);
  }
  return token;
}
