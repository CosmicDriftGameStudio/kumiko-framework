// Allowlist sanitizer for the HTML part of an inbound mail. The result is stored in the event and
// shown by the reader inside a script-free sandboxed iframe; this is the first of the two layers.

import sanitizeHtml from "sanitize-html";

export const BODY_HTML_MAX_LENGTH = 500_000;

const ALLOWED_TAGS = [
  "p",
  "br",
  "div",
  "span",
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "sub",
  "sup",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "img",
  "hr",
  "font",
  "center",
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan", "align", "valign", "width"],
  th: ["colspan", "rowspan", "align", "valign", "width"],
  table: ["width", "cellpadding", "cellspacing", "border", "align"],
  font: ["color", "size"],
  "*": ["style", "dir", "align"],
};

// A style value may carry a remote load (url(), @import) or legacy script (expression()).
const SAFE_STYLE_VALUE = /^(?!.*(?:url\s*\(|expression|@import|javascript:)).*$/i;
const STYLE_PROPERTIES = [
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "font-size",
  "font-family",
  "text-decoration",
  "text-align",
  "line-height",
  "width",
  "max-width",
  "vertical-align",
  ...["padding", "margin", "border"].flatMap((base) => [
    base,
    `${base}-top`,
    `${base}-right`,
    `${base}-bottom`,
    `${base}-left`,
  ]),
];

const ALLOWED_STYLES: Record<string, RegExp[]> = Object.fromEntries(
  STYLE_PROPERTIES.map((property) => [property, [SAFE_STYLE_VALUE]]),
);

// Relative, protocol-relative and backslash URLs would resolve against the app origin in the srcdoc frame
// and send a cookie-carrying same-origin request, so only absolute targets are kept.
const ABSOLUTE_IMAGE_SRC = /^https?:\/\//i;
const ABSOLUTE_LINK_HREF = /^(?:https?:\/\/|mailto:|tel:)/i;

function withoutAttributeUnless(
  attribs: Record<string, string>,
  name: string,
  allowed: RegExp,
): Record<string, string> {
  const value = attribs[name];
  if (value === undefined || allowed.test(value.trim())) return attribs;
  const { [name]: _dropped, ...rest } = attribs;
  return rest;
}

export function sanitizeInboundHtml(html: string): string | null {
  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedStyles: { "*": ALLOWED_STYLES },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...withoutAttributeUnless(attribs, "href", ABSOLUTE_LINK_HREF),
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: withoutAttributeUnless(attribs, "src", ABSOLUTE_IMAGE_SRC),
      }),
    },
    // An image whose src was stripped (cid:, data:, other scheme) is only a broken placeholder.
    exclusiveFilter: (frame) => frame.tag === "img" && frame.attribs["src"] === undefined,
  }).trim();
  return clean.length === 0 || clean.length > BODY_HTML_MAX_LENGTH ? null : clean;
}
