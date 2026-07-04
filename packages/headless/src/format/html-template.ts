// html`...` — Tagged-Template, das jede Interpolation automatisch HTML-escaped.
// Macht Escaping strukturell statt per-Callsite-Konvention: vergessen ist
// unmöglich, bewusst rohes HTML braucht ein explizites raw(). Der
// HTML-Escape-Guard (kumiko-guards) akzeptiert html`...` als safe.

import { escapeHtml } from "./escape";

export class RawHtml {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
  toString(): string {
    return this.html;
  }
}

/** Markiert bereits escaptes/vertrauenswürdiges Markup für html`...`. */
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

// Rückgabe ist RawHtml, damit Fragmente verschachtelbar sind ohne doppelt zu
// escapen: `html`<div>${item}</div>`` innerhalb eines äußeren html`...`
// passiert unverändert durch. toString() liefert das fertige Markup.
export function html(strings: TemplateStringsArray, ...values: ReadonlyArray<HtmlValue>): RawHtml {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += renderValue(value) + (strings[i + 1] ?? "");
  });
  return new RawHtml(out);
}
