import type { TemplateVariableDef, TemplateVariables } from "@cosmicdrift/kumiko-framework/engine";
import type { Element as ScanElement } from "happy-dom";
import { withParsedDocument } from "./document-sanitizer.js";
import {
  isAllowedDocumentLinkHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./document-schema.js";

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

function valueExpression(path: string, def: TemplateVariableDef | undefined): string {
  if (def?.type === "money") return `{{money ${path}}}`;
  if (def?.type === "date") return `{{date ${path}}}`;
  return `{{${path}}}`;
}

function rewriteVariable(element: ScanElement, state: CompileState): void {
  const name = element.getAttribute("data-variable") ?? "";
  const replacement = element.ownerDocument.createTextNode(
    isDocumentReferenceName(name)
      ? marker(state, valueExpression(...pathAndDef(name, element, state)))
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

function rewriteLink(element: ScanElement, state: CompileState): void {
  const href = element.getAttribute("href") ?? "";
  if (isDocumentPlaceholderHref(href)) {
    const name = href.slice(2, -2);
    if (isDocumentReferenceName(name)) {
      const [path] = pathAndDef(name, element, state);
      element.setAttribute("href", marker(state, `{{link ${path}}}`));
    } else {
      element.setAttribute("href", "#");
    }
  } else if (!isAllowedDocumentLinkHref(href)) {
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
};

const RESOURCE_IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// Unique valid resource keys in document order.
export function collectDocumentResourceKeys(html: string): readonly string[] {
  return withParsedDocument(html, (root) => {
    const keys = new Set<string>();
    for (const element of Array.from(root.querySelectorAll("img[data-resource]"))) {
      const key = element.getAttribute("data-resource") ?? "";
      if (isDocumentResourceKey(key)) keys.add(key);
    }
    return [...keys];
  });
}

export function toResourceDataUri(contentType: string, bytes: Uint8Array): string {
  if (!RESOURCE_IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error(`resource content type "${contentType}" cannot be embedded as an image`);
  }
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function rewriteResourceImage(
  element: ScanElement,
  resourceSrc: CompileDocumentBodyOptions["resourceSrc"],
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
}

// Turns a sanitized document body into Handlebars source. Rows and links are
// rewritten in document order; list rows last so their placeholders still see
// the `tr[data-each]` ancestor.
export function compileDocumentBodyToHandlebars(
  html: string,
  variables: TemplateVariables,
  options: CompileDocumentBodyOptions = {},
): string {
  const state: CompileState = { variables, expressions: [] };
  const scrubbed = html.replaceAll(EXPRESSION_OPEN, "").replaceAll(EXPRESSION_CLOSE, "");
  const compiled = withParsedDocument(scrubbed, (root) => {
    for (const element of Array.from(root.querySelectorAll("script"))) element.remove();
    for (const element of Array.from(root.querySelectorAll("img[data-resource]"))) {
      rewriteResourceImage(element, options.resourceSrc);
    }
    for (const element of Array.from(root.querySelectorAll("*"))) stripActiveContent(element);
    for (const element of Array.from(root.querySelectorAll("span[data-variable]"))) {
      rewriteVariable(element, state);
    }
    for (const element of Array.from(root.querySelectorAll("a[href]"))) {
      rewriteLink(element, state);
    }
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
