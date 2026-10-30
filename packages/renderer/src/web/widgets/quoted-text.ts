export type QuotedTextSplit = {
  readonly main: string;
  readonly quoted: string | null;
  readonly quotedLineCount: number;
};

const ATTRIBUTION_LINE = /^(Am|On) .+(schrieb|wrote).*:\s*$/;
const ORIGINAL_MESSAGE_LINE = /^-{3,}\s*(Original Message|Ursprüngliche Nachricht)\s*-{3,}\s*$/i;
const QUOTE_MARK_LINE = /^\s*>/;

function startOfTrailingQuoteBlock(lines: readonly string[]): number {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  let start = end;
  while (start > 0 && QUOTE_MARK_LINE.test(lines[start - 1] ?? "")) start--;
  return start === end ? -1 : start;
}

function startOfQuote(lines: readonly string[]): number {
  const marked = lines.findIndex(
    (line) => ATTRIBUTION_LINE.test(line.trim()) || ORIGINAL_MESSAGE_LINE.test(line.trim()),
  );
  return marked >= 0 ? marked : startOfTrailingQuoteBlock(lines);
}

function countNonBlankLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

/** Folds everything from the first reply attribution, "Original Message" rule or trailing ">" block into `quoted`. */
export function splitQuotedText(text: string): QuotedTextSplit {
  const lines = text.split(/\r?\n/);
  const start = startOfQuote(lines);
  const main = start > 0 ? lines.slice(0, start).join("\n").trimEnd() : "";
  // A mail that is nothing but quote stays visible as it is.
  if (start < 0 || main === "") return { main: text, quoted: null, quotedLineCount: 0 };
  const quoted = lines.slice(start).join("\n").trimEnd();
  return { main, quoted, quotedLineCount: countNonBlankLines(quoted) };
}

export type QuotedHtmlSplit = {
  readonly main: string;
  readonly quoted: string | null;
  readonly quotedLineCount: number;
};

const HTML_QUOTE_SELECTOR =
  'blockquote[type="cite"], .gmail_quote, .moz-cite-prefix, .yahoo_quoted, #divRplyFwdMsg, #appendonsend';

function parseHtmlBody(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html").body;
}

/** Cuts the first quote container and its following siblings out of the body; browser only. */
export function splitQuotedHtml(html: string): QuotedHtmlSplit {
  const body = parseHtmlBody(html);
  const marker = body?.querySelector(HTML_QUOTE_SELECTOR) ?? null;
  if (body === null || marker === null) return { main: html, quoted: null, quotedLineCount: 0 };
  const quotedNodes: Element[] = [];
  for (let node: Element | null = marker; node !== null; node = node.nextElementSibling) {
    quotedNodes.push(node);
  }
  const quoted = quotedNodes.map((node) => node.outerHTML).join("");
  const quotedText = quotedNodes.map((node) => node.textContent ?? "").join("\n");
  for (const node of quotedNodes) node.remove();
  return {
    main: body.innerHTML,
    quoted,
    quotedLineCount: Math.max(1, countNonBlankLines(quotedText)),
  };
}

export function hasRemoteImages(html: string): boolean {
  const body = parseHtmlBody(html);
  if (body === null) return false;
  return Array.from(body.querySelectorAll("img[src]")).some((image) =>
    /^https?:/i.test(image.getAttribute("src") ?? ""),
  );
}

export function plainTextOfHtml(html: string): string {
  return parseHtmlBody(html)?.textContent ?? "";
}
