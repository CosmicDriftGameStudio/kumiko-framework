import type { TemplateVariableDef, TemplateVariables } from "@cosmicdrift/kumiko-framework/engine";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Element as ScanElement } from "happy-dom";
import { isResourceImageContentType } from "../shared/index.ts";
import { rewriteStepsBlock } from "./compile-steps-block.ts";
import { conditionScopeElement, withParsedDocument } from "./document-sanitizer.ts";
import {
  DOCUMENT_CONDITION_ATTRIBUTE,
  DOCUMENT_TEXT_ALIGNMENTS,
  isAllowedDocumentUrlHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./web/document-schema.ts";

// Private-use characters mark where a Handlebars expression goes. Author text
// is scrubbed of them first and every `{`/`}` is entity-encoded before the
// markers are swapped for real expressions, so the only Handlebars syntax in
// the output is the syntax this module wrote.
const EXPRESSION_OPEN = "\uE000";
const EXPRESSION_CLOSE = "\uE001";
const MARKER_PATTERN = /\uE000(\d+)\uE001/g;

type RowScope = { readonly listName: string; readonly itemFields: TemplateVariables } | null;

type CompileState = {
  readonly variables: TemplateVariables;
  readonly expressions: string[];
  // richText spans that fill a whole block; their value brings its own paragraphs.
  readonly blockRichTextSpans: Set<ScanElement>;
};

function marker(state: CompileState, expression: string): string {
  state.expressions.push(expression);
  return `${EXPRESSION_OPEN}${state.expressions.length - 1}${EXPRESSION_CLOSE}`;
}

function ownVariable(variables: TemplateVariables, name: string): TemplateVariableDef | undefined {
  return Object.hasOwn(variables, name) ? variables[name] : undefined;
}

function itemFieldsOf(variables: TemplateVariables, listName: string): TemplateVariables | null {
  const def = ownVariable(variables, listName);
  return def?.type === "list" ? def.item : null;
}

function rowScopeOf(element: ScanElement, state: CompileState): RowScope {
  const listName = element.closest("tr[data-each]")?.getAttribute("data-each") ?? null;
  if (listName === null) return null;
  const itemFields = itemFieldsOf(state.variables, listName);
  return itemFields === null ? null : { listName, itemFields };
}

function resolveReference(
  name: string,
  scope: RowScope,
  variables: TemplateVariables,
): { readonly path: string; readonly def: TemplateVariableDef | undefined } {
  if (scope !== null && ownVariable(scope.itemFields, name) !== undefined) {
    return { path: name, def: ownVariable(scope.itemFields, name) };
  }
  return { path: scope === null ? name : `@root.${name}`, def: ownVariable(variables, name) };
}

// The sanitized rich text value always consists of blocks; inside a line of
// other text it renders inline so no paragraph ends up inside a paragraph.
function valueExpression(
  path: string,
  def: TemplateVariableDef | undefined,
  isWholeBlock: boolean,
): string {
  if (def?.type === "money") return `{{money ${path}}}`;
  if (def?.type === "date") return `{{date ${path}}}`;
  if (def?.type === "percent") return `{{percent ${path}}}`;
  if (def?.type === "richText") {
    return isWholeBlock ? `{{richText ${path}}}` : `{{richText ${path} inline=true}}`;
  }
  return `{{${path}}}`;
}

// Never interpolated as text: its value is a list of file ids.
function isImagesVariable(def: TemplateVariableDef | undefined): boolean {
  return def?.type === "images";
}

function rewriteVariable(element: ScanElement, state: CompileState): void {
  const name = element.getAttribute("data-variable") ?? "";
  const replacement = element.ownerDocument.createTextNode(
    isDocumentReferenceName(name) && !isImagesVariable(pathAndDef(name, element, state)[1])
      ? marker(
          state,
          valueExpression(
            ...pathAndDef(name, element, state),
            state.blockRichTextSpans.has(element),
          ),
        )
      : "",
  );
  element.replaceWith(replacement);
}

function pathAndDef(
  name: string,
  element: ScanElement,
  state: CompileState,
): [string, TemplateVariableDef | undefined] {
  const { path, def } = resolveReference(name, rowScopeOf(element, state), state.variables);
  return [path, def];
}

const VARIABLE_ONLY_BLOCK_SELECTOR = "p, h1, h2, h3, h4";

function soleVariableName(block: ScanElement): string | null {
  const names = new Set(
    Array.from(block.querySelectorAll("span[data-variable]")).map(
      (span) => span.getAttribute("data-variable") ?? "",
    ),
  );
  const [name] = [...names];
  if (names.size !== 1 || name === undefined || !isDocumentReferenceName(name)) return null;
  const withoutVariables = block.cloneNode(true);
  for (const span of Array.from(withoutVariables.querySelectorAll("span[data-variable]"))) {
    span.remove();
  }
  const hasStaticContent =
    (withoutVariables.textContent ?? "").trim() !== "" ||
    withoutVariables.querySelector("img") !== null;
  return hasStaticContent ? null : name;
}

// A line that holds nothing but one optional placeholder would otherwise leave
// an empty paragraph (a visible gap) when the value is missing. includeZero
// keeps an amount of 0.
function wrapVariableOnlyBlock(block: ScanElement, state: CompileState): void {
  const name = soleVariableName(block);
  // skip: a line with static content or several placeholders stays as it is
  if (name === null) return;
  const [path, def] = pathAndDef(name, block, state);
  // skip: images blocks are rewritten by rewriteImagesBlock
  if (isImagesVariable(def)) return;
  const host =
    def?.type === "richText" && block.tagName === "P" ? richTextBlockHost(block, state) : block;
  const document = host.ownerDocument;
  host.before(document.createTextNode(marker(state, `{{#if ${path} includeZero=true}}`)));
  host.after(document.createTextNode(marker(state, "{{/if}}")));
}

// A paragraph cannot hold the paragraphs of a rich text value, a div can; it
// keeps the paragraph's attributes so alignment and size still apply.
function richTextBlockHost(paragraph: ScanElement, state: CompileState): ScanElement {
  const host = paragraph.ownerDocument.createElement("div");
  for (const attribute of Array.from(paragraph.attributes)) {
    host.setAttribute(attribute.name, attribute.value ?? "");
  }
  for (const span of Array.from(paragraph.querySelectorAll("span[data-variable]"))) {
    state.blockRichTextSpans.add(span);
  }
  host.append(...Array.from(paragraph.childNodes));
  paragraph.replaceWith(host);
  return host;
}

function rewriteLink(element: ScanElement, state: CompileState): void {
  const href = element.getAttribute("href") ?? "";
  if (isDocumentPlaceholderHref(href)) {
    const name = href.slice(2, -2);
    if (isDocumentReferenceName(name)) {
      const [path, def] = pathAndDef(name, element, state);
      element.setAttribute("href", isImagesVariable(def) ? "#" : marker(state, `{{link ${path}}}`));
    } else {
      element.setAttribute("href", "#");
    }
  } else if (!isAllowedDocumentUrlHref(href)) {
    element.setAttribute("href", "#");
  }
}

function rewriteRepeatRow(row: ScanElement, state: CompileState): void {
  const listName = row.getAttribute("data-each") ?? "";
  const document = row.ownerDocument;
  if (itemFieldsOf(state.variables, listName) === null || !isDocumentReferenceName(listName)) {
    row.remove();
  } else {
    row.before(document.createTextNode(marker(state, `{{#each ${listName}}}`)));
    row.after(document.createTextNode(marker(state, "{{/each}}")));
    row.removeAttribute("data-each");
    row.removeAttribute("data-repeat-header");
  }
}

function rewriteConditionalBlock(block: ScanElement, state: CompileState): void {
  const name = block.getAttribute(DOCUMENT_CONDITION_ATTRIBUTE) ?? "";
  block.removeAttribute(DOCUMENT_CONDITION_ATTRIBUTE);
  if (!isDocumentReferenceName(name)) {
    block.remove();
    // skip: a condition on a name that cannot be a variable never shows
    return;
  }
  const [path] = pathAndDef(name, conditionScopeElement(block), state);
  const document = block.ownerDocument;
  block.before(document.createTextNode(marker(state, `{{#if ${path} includeZero=true}}`)));
  block.after(document.createTextNode(marker(state, "{{/if}}")));
}

function stripActiveContent(element: ScanElement): void {
  for (const attribute of Array.from(element.attributes)) {
    if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
  }
}

function neutralizeBraces(html: string): string {
  return html.replace(/[{}]/g, (brace) => (brace === "{" ? "&#123;" : "&#125;"));
}

export type CompileDocumentBodyOptions = {
  // Returns the src for an `img[data-resource]` key; undefined drops the image.
  readonly resourceSrc?: (key: string) => string | undefined;
  // Mail clients ignore document CSS, so a full-width logo needs an inline width cap.
  readonly resourceImageMaxWidthPx?: number;
  // Keeps a square logo in a mail header from growing to the full width cap.
  readonly resourceImageMaxHeightPx?: number;
  // Mail clients ignore document CSS, so mail turns data-align into an inline style.
  readonly alignmentAsInlineStyle?: boolean;
  // Same reason: a[data-button] only looks like a button through editor/print CSS.
  readonly buttonAsInlineStyle?: boolean;
  // Same reason: cell padding and table width only exist in editor/print CSS, so without
  // inline styles a mail table renders its cells flush against each other.
  readonly tableAsInlineStyle?: boolean;
  // Replaces the default button look; only values from the layout appearance belong here.
  readonly buttonInlineStyle?: string;
  // Mail clients ignore document CSS, so headings get their size and weight inline.
  readonly headingAsInlineStyle?: boolean;
  // Bar color of reached stages in a steps block; ignored unless it is a #rrggbb hex.
  readonly stepsColor?: string;
  // Data URIs of the record's images for the images block bound to `variable`.
  readonly recordImagesSrc?: (variable: string) => readonly string[];
  // Previews and drafts never read the record's files; each images block shows one neutral box.
  readonly recordImagesPlaceholder?: boolean;
};

const IMAGES_PLACEHOLDER_STYLE = "height:96px;margin:8px 0;border-radius:4px;background:#e5e7eb";

const MAIL_BUTTON_STYLE =
  "display:inline-block;padding:10px 20px;border-radius:6px;background-color:#1f5468;color:#ffffff;font-weight:600;text-decoration:none";

const MAIL_TABLE_STYLE = "width:100%;border-collapse:collapse";
const MAIL_TABLE_CELL_STYLE = "padding:6px 12px;vertical-align:top;border-bottom:1px solid #e5e5e5";
const MAIL_TABLE_HEAD_STYLE = "font-size:12px;font-weight:600;color:#6b7280;text-align:left";
const MAIL_SMALL_STYLE = "font-size:13px;color:#4A515E";
const MAIL_HEADING_STYLES: Readonly<Record<string, string>> = {
  h1: "margin:0 0 12px 0;font-size:30px;line-height:1.15;font-weight:700;letter-spacing:-0.035em;color:#0B0D12",
  h2: "margin:0 0 12px 0;font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:#0B0D12",
  h3: "margin:20px 0 8px 0;font-size:17px;line-height:1.3;font-weight:600;color:#0B0D12",
};

// Appended after an existing style (data-align) so the alignment survives.
function appendStyle(element: ScanElement, style: string): void {
  const existing = element.getAttribute("style");
  element.setAttribute("style", existing === null ? style : `${existing};${style}`);
}

function collectUniqueValidAttributes(
  html: string,
  selector: string,
  attribute: string,
  isValid: (value: string) => boolean,
): readonly string[] {
  return withParsedDocument(html, (root) => {
    const values = new Set<string>();
    for (const element of Array.from(root.querySelectorAll(selector))) {
      const value = element.getAttribute(attribute) ?? "";
      if (isValid(value)) values.add(value);
    }
    return [...values];
  });
}

// Unique valid resource keys in document order.
export function collectDocumentResourceKeys(html: string): readonly string[] {
  return collectUniqueValidAttributes(
    html,
    "img[data-resource]",
    "data-resource",
    isDocumentResourceKey,
  );
}

// Unique valid names of the images blocks in document order.
export function collectDocumentImageVariables(html: string): readonly string[] {
  return collectUniqueValidAttributes(
    html,
    "div[data-images]",
    "data-images",
    isDocumentReferenceName,
  );
}

function rewriteImagesBlock(
  element: ScanElement,
  state: CompileState,
  options: CompileDocumentBodyOptions,
): void {
  const name = element.getAttribute("data-images") ?? "";
  const declared =
    isDocumentReferenceName(name) && isImagesVariable(ownVariable(state.variables, name));
  if (!declared) {
    element.remove();
    // skip: an images block bound to anything but a declared images variable renders nothing
    return;
  }
  const document = element.ownerDocument;
  element.removeAttribute("data-images");
  if (options.recordImagesPlaceholder === true) {
    element.setAttribute("class", "kumiko-doc-image-placeholder");
    element.setAttribute("style", IMAGES_PLACEHOLDER_STYLE);
    // skip: preview and drafts never resolve record images
    return;
  }
  element.setAttribute("class", "kumiko-doc-images");
  for (const src of options.recordImagesSrc?.(name) ?? []) {
    const image = document.createElement("img");
    image.setAttribute("src", src);
    image.setAttribute("alt", "");
    element.append(image);
  }
}

export function toResourceDataUri(contentType: string, bytes: Uint8Array): string {
  if (!isResourceImageContentType(contentType)) {
    throw new Error(`resource content type "${contentType}" cannot be embedded as an image`);
  }
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function rewriteAlignment(element: ScanElement): void {
  const align = element.getAttribute("data-align");
  element.removeAttribute("data-align");
  if (isOneOf(DOCUMENT_TEXT_ALIGNMENTS, align))
    element.setAttribute("style", `text-align:${align}`);
}

function rewriteResourceImage(
  element: ScanElement,
  resourceSrc: CompileDocumentBodyOptions["resourceSrc"],
  maxWidthPx: number | undefined,
  maxHeightPx: number | undefined,
): void {
  const key = element.getAttribute("data-resource") ?? "";
  const src = isDocumentResourceKey(key) ? resourceSrc?.(key) : undefined;
  if (src === undefined) {
    element.remove();
    // skip: an unresolved resource key drops the image
    return;
  }
  element.setAttribute("src", src);
  element.removeAttribute("data-resource");
  const caps = [
    ...(maxWidthPx === undefined ? [] : [`max-width:${maxWidthPx}px`]),
    ...(maxHeightPx === undefined ? [] : [`max-height:${maxHeightPx}px;width:auto`]),
  ];
  if (caps.length > 0) element.setAttribute("style", `${caps.join(";")};height:auto`);
}

function stripScriptsAndActiveContent(
  root: ScanElement,
  options: CompileDocumentBodyOptions,
): void {
  for (const element of Array.from(root.querySelectorAll("script"))) element.remove();
  for (const element of Array.from(root.querySelectorAll("img[data-resource]"))) {
    rewriteResourceImage(
      element,
      options.resourceSrc,
      options.resourceImageMaxWidthPx,
      options.resourceImageMaxHeightPx,
    );
  }
  for (const element of Array.from(root.querySelectorAll("*"))) stripActiveContent(element);
}

function applyAlignmentInlineStyles(root: ScanElement): void {
  for (const element of Array.from(root.querySelectorAll("[data-align]"))) {
    rewriteAlignment(element);
  }
  for (const element of Array.from(root.querySelectorAll("[data-size]"))) {
    element.removeAttribute("data-size");
    appendStyle(element, MAIL_SMALL_STYLE);
  }
}

function applyHeadingInlineStyles(root: ScanElement): void {
  for (const heading of Array.from(root.querySelectorAll("h1, h2, h3"))) {
    const style = MAIL_HEADING_STYLES[heading.tagName.toLowerCase()];
    if (style !== undefined) appendStyle(heading, style);
  }
}

function applyTableInlineStyles(root: ScanElement): void {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    appendStyle(table, MAIL_TABLE_STYLE);
  }
  for (const cell of Array.from(root.querySelectorAll("td, th"))) {
    appendStyle(cell, MAIL_TABLE_CELL_STYLE);
  }
  for (const head of Array.from(root.querySelectorAll("th"))) {
    appendStyle(head, MAIL_TABLE_HEAD_STYLE);
  }
}

function rewriteLinks(
  root: ScanElement,
  state: CompileState,
  options: CompileDocumentBodyOptions,
): void {
  for (const element of Array.from(root.querySelectorAll("a[href]"))) {
    rewriteLink(element, state);
    if (options.buttonAsInlineStyle === true && element.hasAttribute("data-button")) {
      element.setAttribute("style", options.buttonInlineStyle ?? MAIL_BUTTON_STYLE);
    }
  }
}

// Turns a sanitized document body into Handlebars source. Rows and links are
// rewritten in document order; list rows last so their placeholders still see
// the `tr[data-each]` ancestor.
export function compileDocumentBodyToHandlebars(
  html: string,
  variables: TemplateVariables,
  options: CompileDocumentBodyOptions = {},
): string {
  const state: CompileState = { variables, expressions: [], blockRichTextSpans: new Set() };
  const scrubbed = html.replaceAll(EXPRESSION_OPEN, "").replaceAll(EXPRESSION_CLOSE, "");
  const compiled = withParsedDocument(scrubbed, (root) => {
    stripScriptsAndActiveContent(root, options);
    if (options.alignmentAsInlineStyle === true) applyAlignmentInlineStyles(root);
    if (options.headingAsInlineStyle === true) applyHeadingInlineStyles(root);
    if (options.tableAsInlineStyle === true) applyTableInlineStyles(root);
    for (const element of Array.from(root.querySelectorAll("div[data-steps]"))) {
      rewriteStepsBlock(element, {
        expression: (source) => marker(state, source),
        pathOf: (name, at) => pathAndDef(name, at, state)[0],
        color: options.stepsColor,
      });
    }
    for (const element of Array.from(root.querySelectorAll("div[data-images]"))) {
      rewriteImagesBlock(element, state, options);
    }
    // Order matters: the conditional wraps first so the row's #each lands inside the #if (evaluated once per list).
    for (const block of Array.from(root.querySelectorAll(`[${DOCUMENT_CONDITION_ATTRIBUTE}]`))) {
      rewriteConditionalBlock(block, state);
    }
    for (const block of Array.from(root.querySelectorAll(VARIABLE_ONLY_BLOCK_SELECTOR))) {
      wrapVariableOnlyBlock(block, state);
    }
    for (const element of Array.from(root.querySelectorAll("span[data-variable]"))) {
      rewriteVariable(element, state);
    }
    rewriteLinks(root, state, options);
    for (const element of Array.from(root.querySelectorAll("tr[data-each]"))) {
      rewriteRepeatRow(element, state);
    }
    return root.innerHTML;
  });
  return neutralizeBraces(compiled).replace(
    MARKER_PATTERN,
    (_match, index: string) => state.expressions[Number(index)] ?? "",
  );
}
