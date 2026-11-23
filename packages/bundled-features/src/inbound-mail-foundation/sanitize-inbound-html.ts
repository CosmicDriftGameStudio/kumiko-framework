// Allowlist sanitizer for the HTML part of an inbound mail. The result is stored in the event and
// shown by the reader inside a script-free sandboxed iframe; this is the first of the two layers.

import { convert as htmlToText } from "html-to-text";
import sanitizeHtml from "sanitize-html";
import { tagOpenerBudgetCutoff } from "../shared/index.ts";
import { INBOUND_BODY_HTML_MAX_BYTES } from "./normalize-inbound-message.ts";

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
  div: ["class", "id"],
  blockquote: ["class", "type"],
  "*": ["style", "dir", "align"],
};

// Exactly the markers the reader's quote folding looks for (Gmail, Apple Mail, Thunderbird, Yahoo, Outlook).
const QUOTE_CLASS_NAMES = ["gmail_quote", "moz-cite-prefix", "yahoo_quoted"];
const QUOTE_ELEMENT_IDS = new Set(["divRplyFwdMsg", "appendonsend"]);

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

function withoutIdUnlessQuoteMarker(attribs: Record<string, string>): Record<string, string> {
  const id = attribs["id"];
  if (id === undefined || QUOTE_ELEMENT_IDS.has(id.trim())) return attribs;
  const { id: _dropped, ...rest } = attribs;
  return rest;
}

// htmlparser2 keeps its element stack in an array with the top at the front; opening and every
// unmatched end tag cost time linear in the depth. Same value as mailparser, Chrome flattens at 512.
export const INBOUND_HTML_MAX_NESTING_DEPTH = 1000;

// Every tag token starts with '<'. Counting '<' instead of characters keeps long data: URLs and prose
// out of the budget. At full depth 250k unmatched end tags cost about 0.3 s (277 ms measured at depth
// 999); a 3000-row newsletter table has 30k.
export const INBOUND_HTML_MAX_TAG_OPENERS = 250_000;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  allowedStyles: { "*": ALLOWED_STYLES },
  allowedClasses: { div: QUOTE_CLASS_NAMES, blockquote: QUOTE_CLASS_NAMES },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  transformTags: {
    div: (tagName, attribs) => ({ tagName, attribs: withoutIdUnlessQuoteMarker(attribs) }),
    blockquote: (tagName, attribs) => ({
      tagName,
      attribs: withoutAttributeUnless(attribs, "type", /^cite$/),
    }),
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
};

class InboundHtmlTooDeepError extends Error {}

// html-to-text prefixes every line with "> " per open blockquote and with indentation per list level,
// so its output grows with this depth times the line count. Measured: 900 blockquotes around 20,000
// lines (51 KB of HTML) took 1.3 s and produced 36 MB of text. The product of depth and HTML length
// bounds that at roughly 15 to 20 MB; real mails nest 1 to 3 levels.
const TEXT_PREFIX_DEPTH_TIMES_LENGTH_MAX = 5_000_000;
const TEXT_PREFIX_ELEMENTS = new Set(["blockquote", "ul", "ol"]);

// The text path never reaches a browser, so structure tags the display allowlist drops are kept here:
// without them html-to-text sees no <body> (the <title> text leaks into the text) and glues
// <section>, <header> and <footer> content together.
const TEXT_ONLY_STRUCTURE_TAGS = [
  "html",
  "head",
  "title",
  "body",
  "header",
  "footer",
  "section",
  "article",
  "aside",
  "main",
  "nav",
  "form",
];
const TEXT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  ...SANITIZE_OPTIONS,
  allowedTags: [...ALLOWED_TAGS, ...TEXT_ONLY_STRUCTURE_TAGS],
};

type ParseLimitedHtml = { readonly html: string; readonly maxPrefixDepth: number };

// The stack holds the names sanitize-html reports as opened. htmlparser2 also reports a close for a
// tag that was never reported open (a truncated "<b " inside the text of a dropped iframe, which
// sanitize-html parses again with the same options), so a bare counter can be pulled below the real
// depth. Throwing from the callback aborts the parse before the quadratic cost accrues. State stays
// local because the iframe fallback reuses the options and a throw must leave nothing for the next call.
function sanitizeWithinParseLimits(
  html: string,
  options: sanitizeHtml.IOptions,
): ParseLimitedHtml | null {
  if (tagOpenerBudgetCutoff(html, INBOUND_HTML_MAX_TAG_OPENERS) !== -1) return null;
  const open: string[] = [];
  let prefixDepth = 0;
  let maxPrefixDepth = 0;
  try {
    const clean = sanitizeHtml(html, {
      ...options,
      onOpenTag: (name) => {
        open.push(name);
        if (open.length > INBOUND_HTML_MAX_NESTING_DEPTH) throw new InboundHtmlTooDeepError();
        if (TEXT_PREFIX_ELEMENTS.has(name)) {
          prefixDepth += 1;
          maxPrefixDepth = Math.max(maxPrefixDepth, prefixDepth);
        }
      },
      onCloseTag: (name) => {
        if (open[open.length - 1] !== name) return;
        open.pop();
        if (TEXT_PREFIX_ELEMENTS.has(name)) prefixDepth -= 1;
      },
    }).trim();
    return { html: clean, maxPrefixDepth };
  } catch (error) {
    if (error instanceof InboundHtmlTooDeepError) return null;
    throw error;
  }
}

export function sanitizeInboundHtml(html: string): string | null {
  const limited = sanitizeWithinParseLimits(html, SANITIZE_OPTIONS);
  if (limited === null || limited.html.length === 0) return null;
  return Buffer.byteLength(limited.html, "utf8") > INBOUND_BODY_HTML_MAX_BYTES
    ? null
    : limited.html;
}

// html-to-text parses with its own htmlparser2 10, which closes <a> and headings differently; the
// sanitized HTML is balanced, so the depth limit holds there too. Past the tag budget the HTML is cut
// instead of dropped: only the first 32,000 characters of text are stored anyway, and a report mail
// of 260,000 tags should still show its opening text.
export function inboundHtmlToText(html: string): string {
  const cutoff = tagOpenerBudgetCutoff(html, INBOUND_HTML_MAX_TAG_OPENERS);
  const limited = sanitizeWithinParseLimits(
    cutoff === -1 ? html : html.slice(0, cutoff),
    TEXT_SANITIZE_OPTIONS,
  );
  if (limited === null || limited.html.length === 0) return "";
  if (limited.maxPrefixDepth * limited.html.length > TEXT_PREFIX_DEPTH_TIMES_LENGTH_MAX) return "";
  return htmlToText(limited.html, { limits: { maxDepth: INBOUND_HTML_MAX_NESTING_DEPTH } }).trim();
}
