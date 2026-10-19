// html`...` — tagged template that HTML-escapes every interpolation automatically.
// Makes escaping structural instead of a per-call-site convention: forgetting
// it is impossible, deliberately raw HTML needs an explicit raw(). The
// HTML-escape guard (kumiko-guards) accepts html`...` as safe.

import { escapeHtml } from "./escape.ts";

export class RawHtml {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
  toString(): string {
    return this.html;
  }
}

/** Marks already escaped or trusted markup for html`...`. */
export function raw(html: string): RawHtml {
  return new RawHtml(html);
}

export type HtmlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RawHtml
  | ReadonlyArray<HtmlValue>;

function renderValue(value: HtmlValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof RawHtml) return value.html;
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (typeof value === "string") return escapeHtml(value);
  return String(value);
}

// Returns RawHtml so fragments can be nested without double escaping:
// `html`<div>${item}</div>`` inside an outer html`...` passes through
// unchanged. toString() yields the finished markup.
export function html(strings: TemplateStringsArray, ...values: ReadonlyArray<HtmlValue>): RawHtml {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += renderValue(value) + (strings[i + 1] ?? "");
  });
  return new RawHtml(out);
}
