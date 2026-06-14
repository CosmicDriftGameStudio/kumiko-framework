// Allowlist-based CSS sanitizer for UNTRUSTED tenant-supplied CSS (managed-pages
// custom-css capability). Security model: allowlist-by-construction — the output
// is REBUILT from validated tokens (scope-prefixed selector + allowed
// `property: value` pairs), never a filtered passthrough of the input. A rule
// that doesn't parse cleanly into that shape is dropped whole (fail-closed).
// `url()`, `@import`, `expression()` and friends are closed BY CONSTRUCTION:
// they can never match an allowed value grammar, so we never depend on detecting
// their literal spelling — which CSS escape sequences like `\75rl(` would defeat.
//
// Scoping: every selector is prefixed with `scopeSelector`, so a tenant rule can
// only style elements INSIDE the page-content container — never `html`/`body`/
// `:root` (those become inert: no such element is a descendant of the scope) and
// never another tenant's content. A segment may NOT start with a combinator
// (`~ X`/`+ X`/`> X` would reach the scope's siblings/parent — the host chrome);
// internal combinators stay in-scope. The container element itself is unreachable
// (descendant combinator), so the host-emitted containment styles — including the
// `overflow` clip and `isolation` in layout.ts — can't be overridden by tenant CSS.
//
// Hard rejections (no presentational CSS needs them): any `\` (escape-sequence
// bypass), any `@`-rule (no `@media`/`@font-face`/`@import`), any function token
// outside {rgb,rgba,hsl,hsla,calc} (closes `url`/`expression`/`var`/`image-set`),
// any `[`/`]` (attribute selectors), `::` AND single-colon `:before`/`:after`/
// `:first-line`/`:first-letter` (pseudo-elements → content/defacement), `url(`/
// `expression(` in a selector, and `<`/`>`/`"`/`'`/`{`/`}`/`;`/`@` inside a value.
//
// Residual (documented, tier-gated): best-effort defense-in-depth for untrusted
// tenants. The surface is deliberately small — no at-rules, no `url()`, no
// `var()`/custom-props, no pseudo-elements, no quotes in values, no leading
// combinators. A scoped element can still RESTYLE/DEFACE its own page area
// (within the container's `overflow` clip) — that is the tenant's own content,
// not host chrome. Keep CSS-inject behind the operator/tier gate; this is not a
// hard isolation boundary (an iframe sandbox would be).

const MAX_CSS_LENGTH = 8000;

// Presentational properties only. `position` is intentionally NOT here — it is
// allowed with a value constraint (fixed/sticky enable viewport overlays /
// clickjacking), handled in sanitizeValue.
const ALLOWED_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "color",
  "background-color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-align",
  "text-decoration",
  "text-transform",
  "text-indent",
  "text-shadow",
  "white-space",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "border-color",
  "border-width",
  "border-style",
  "border-radius",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "box-shadow",
  "outline",
  "outline-color",
  "outline-width",
  "outline-style",
  "width",
  "max-width",
  "min-width",
  "height",
  "max-height",
  "min-height",
  "display",
  "opacity",
  "visibility",
  "list-style",
  "list-style-type",
  "list-style-position",
  "vertical-align",
  "cursor",
  "box-sizing",
  "transition",
  "transition-property",
  "transition-duration",
  "transition-timing-function",
  "transition-delay",
  "transform",
  "transform-origin",
  "z-index",
]);

// `position` is allowed only with these values — `fixed`/`sticky` (and anything
// unknown) is dropped to deny viewport-pinned overlays / clickjacking.
const ALLOWED_POSITION_VALUES: ReadonlySet<string> = new Set<string>([
  "static",
  "relative",
  "absolute",
]);

const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "calc",
]);

// Permitted value chars AFTER `!important` is split off. No `\` (escapes), no
// `<`/`>`/`{`/`}`/`@`/`;` (breakouts), no quotes (string sinks like `content`,
// quoted `url("…")`). `*` and `/` are kept for `calc()`.
const VALUE_CHARS = /^[a-zA-Z0-9 \t.,#%()/*+-]+$/;
const FUNCTION_NAME = /([a-zA-Z][a-zA-Z0-9-]*)\s*\(/g;
const IMPORTANT_SUFFIX = /\s*!\s*important\s*$/i;

// Permitted selector chars. Class/id/element idents, descendant/child/sibling
// combinators, single-colon pseudo-CLASS, universal, `()` for `:not()`/
// `:nth-child()`. No `[`/`]` (attribute selectors), no `,` (split earlier), no
// `\`/quotes/braces/`@`/angle brackets. `::` is rejected separately.
const SELECTOR_CHARS = /^[a-zA-Z0-9 \t.#:>+~*_()-]+$/;
// A segment may NOT start with a combinator: `[scope] ~ X` / `[scope] + X` reach
// the scope container's SIBLINGS (e.g. the host brand-header) and `[scope] > X`
// its direct children-from-outside — all escape "descendants only". Internal
// combinators (`.a > .b`, `.a ~ .b`) stay in-scope and are fine.
const LEADING_COMBINATOR = /^[>+~]/;
// Single-colon legacy pseudo-elements are pseudo-elements too — the `::` check
// alone misses them. Reject both syntaxes (no pseudo-elements at all).
const LEGACY_PSEUDO_ELEMENT = /:(?:before|after|first-line|first-letter)\b/i;
// `url()`/`expression()` in a SELECTOR (e.g. inside `:not()`) don't fetch/execute
// — selector context never loads resources — but reject them anyway so no such
// token ever reaches output (defense-in-depth, avoids engine quirks).
const SELECTOR_FUNCTION_SINK = /(?:url|expression)\s*\(/i;

type RawRule = { readonly prelude: string; readonly block: string };

function stripComments(css: string): string {
  let out = "";
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) break; // unterminated comment → drop the rest (fail-closed)
      i = end + 2;
      out += " "; // a space so `@im/**/port` can't re-form a single token
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

// Brace-depth-aware rule extractor. At depth 0, everything up to `{` is the
// prelude; the matching `}` (tracking nested braces, e.g. an at-rule body)
// closes the block. An unbalanced trailing `{` drops the rest (fail-closed).
function extractRules(css: string): RawRule[] {
  const rules: RawRule[] = [];
  let prelude = "";
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (ch === "{") {
      let depth = 1;
      let block = "";
      i++;
      while (i < n && depth > 0) {
        const c = css[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        block += c;
        i++;
      }
      if (depth > 0) return rules; // unbalanced → fail-closed
      rules.push({ prelude, block });
      prelude = "";
      continue;
    }
    if (ch === "}") {
      prelude = ""; // stray close brace → reset
      i++;
      continue;
    }
    prelude += ch;
    i++;
  }
  return rules; // trailing prelude without a block is discarded
}

function splitTopLevel(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      parts.push(buf);
      buf = "";
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return parts;
}

function parensBalanced(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function sanitizeSelector(seg: string, scope: string): string | null {
  const s = seg.trim();
  if (s === "") return null;
  if (s.includes("\\")) return null; // escape-sequence bypass
  if (s.includes("::")) return null; // no pseudo-elements (content/defacement)
  if (LEGACY_PSEUDO_ELEMENT.test(s)) return null; // single-colon pseudo-elements
  if (LEADING_COMBINATOR.test(s)) return null; // scope-escape via leading >/+/~
  if (SELECTOR_FUNCTION_SINK.test(s)) return null; // no url()/expression() in selectors
  if (!SELECTOR_CHARS.test(s)) return null; // rejects [ ] , < > { } @ " '
  if (!parensBalanced(s)) return null;
  return `${scope} ${s}`;
}

function sanitizeValue(prop: string, rawValue: string): string | null {
  let value = rawValue.trim();
  if (value === "") return null;
  if (value.includes("\\")) return null; // escape-sequence bypass

  let important = "";
  const imp = value.match(IMPORTANT_SUFFIX);
  if (imp) {
    important = " !important";
    value = value.slice(0, value.length - imp[0].length).trim();
    if (value === "") return null;
  }

  if (!VALUE_CHARS.test(value)) return null;
  if (!parensBalanced(value)) return null;

  // Every function token must be an allowed function — this is what closes
  // url()/expression()/var()/image-set() without matching their literal names.
  FUNCTION_NAME.lastIndex = 0;
  let m: RegExpExecArray | null = FUNCTION_NAME.exec(value);
  while (m !== null) {
    const fnName = m[1];
    if (fnName === undefined || !ALLOWED_FUNCTIONS.has(fnName.toLowerCase())) return null;
    m = FUNCTION_NAME.exec(value);
  }

  if (prop === "position" && !ALLOWED_POSITION_VALUES.has(value.toLowerCase())) {
    return null;
  }
  return value + important;
}

function sanitizeDeclarations(block: string): string {
  const out: string[] = [];
  for (const part of block.split(";")) {
    const decl = part.trim();
    if (decl === "") continue;
    if (decl.includes("\\")) continue;
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    if (prop !== "position" && !ALLOWED_PROPERTIES.has(prop)) continue;
    const value = sanitizeValue(prop, decl.slice(colon + 1));
    if (value === null) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

function sanitizeRule(rule: RawRule, scope: string): string | null {
  const prelude = rule.prelude.trim();
  if (prelude === "") return null;
  if (prelude.startsWith("@")) return null; // no at-rules
  if (prelude.includes("\\")) return null; // escape-sequence bypass

  const scoped: string[] = [];
  for (const seg of splitTopLevel(prelude, ",")) {
    const s = sanitizeSelector(seg, scope);
    if (s === null) return null; // any bad selector segment → drop the rule
    scoped.push(s);
  }

  const decls = sanitizeDeclarations(rule.block);
  if (decls === "") return null;
  return `${scoped.join(", ")} { ${decls} }`;
}

// Sanitize untrusted tenant CSS into a scoped, allowlisted stylesheet string
// safe to drop into `<style>${...}</style>`. `scopeSelector` (e.g.
// `[data-tenant-content]`) is prefixed onto every selector. Returns "" for
// empty/over-cap/fully-rejected input — the caller emits no `<style>` block then.
export function sanitizeTenantCss(css: string, scopeSelector: string): string {
  if (typeof css !== "string") return "";
  if (css.length === 0 || css.length > MAX_CSS_LENGTH) return "";

  const decommented = stripComments(css);
  const out: string[] = [];
  for (const rule of extractRules(decommented)) {
    const s = sanitizeRule(rule, scopeSelector);
    if (s !== null) out.push(s);
  }
  const result = out.join("\n");

  // Final breakout assert — reject any `<`, which is the only way to begin the
  // `</style>` sequence that exits the RAWTEXT <style> element. `>` is left
  // intact: it is a valid CSS child combinator and inert inside <style>.
  if (result.includes("<")) return "";
  return result;
}
