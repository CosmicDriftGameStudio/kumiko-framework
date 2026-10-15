// Server-only: pulls in happy-dom via @tiptap/html/server, so it must stay out
// of client barrels and the document-schema subpath export.
import type { FieldIssue } from "@cosmicdrift/kumiko-framework/errors";
import { generateHTML, generateJSON } from "@tiptap/html/server";
import { type Element as ScanElement, Window } from "happy-dom";
import type { ContentFormat } from "./constants.js";
import { DOCUMENT_HTML_KINDS } from "./constants.js";
import {
  documentExtensions,
  isAllowedDocumentLinkHref,
  isDocumentPlaceholderHref,
  isDocumentReferenceName,
  isDocumentResourceKey,
} from "./document-schema.js";

export type DocumentViolationCode =
  | "script_element"
  | "event_handler_attribute"
  | "disallowed_link_href"
  | "external_image_source"
  | "image_without_resource"
  | "invalid_reference_name"
  | "embedded_content"
  | "unsafe_attribute_value"
  | "button_href_not_placeholder"
  | "document_requires_html_format";

export type DocumentViolation = {
  readonly code: DocumentViolationCode;
  readonly detail: string;
  readonly message: string;
};

export type SanitizeHtmlResult =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly violations: readonly DocumentViolation[] };

export type SanitizeBodyResult =
  | { readonly ok: true; readonly content: string | null }
  | { readonly ok: false; readonly violations: readonly DocumentViolation[] };

function violation(
  code: DocumentViolationCode,
  detail: string,
  message: string,
): DocumentViolation {
  return { code, detail, message };
}

// Same switches tiptap's generateJSON uses, plus navigation off: the scan
// window must never fetch or navigate anything.
function createScanWindow(): Window {
  return new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
      },
    },
  });
}

function scanScriptAndHandlers(tag: string, element: ScanElement, out: DocumentViolation[]): void {
  if (tag === "script") {
    out.push(
      violation("script_element", "script", "<script> elements are not allowed in template bodies"),
    );
  }
  for (const attribute of Array.from(element.attributes)) {
    if (/^on/i.test(attribute.name)) {
      out.push(
        violation(
          "event_handler_attribute",
          attribute.name,
          `Inline event handler "${attribute.name}" on <${tag}> is not allowed`,
        ),
      );
    }
  }
}

function scanAnchor(element: ScanElement, out: DocumentViolation[]): void {
  const href = element.getAttribute("href");
  if (href !== null && !isAllowedDocumentLinkHref(href)) {
    out.push(
      violation(
        "disallowed_link_href",
        href,
        `Link target "${href}" is not allowed; use https, http, mailto, tel or a {{placeholder}}`,
      ),
    );
  }
  if (element.hasAttribute("data-button") && !isDocumentPlaceholderHref(href ?? "")) {
    out.push(
      violation(
        "button_href_not_placeholder",
        href ?? "",
        `Button target "${href ?? ""}" must be a {{placeholder}}`,
      ),
    );
  }
}

function scanImage(element: ScanElement, out: DocumentViolation[]): void {
  const source = element.getAttribute("src") ?? element.getAttribute("srcset");
  if (source !== null) {
    out.push(
      violation(
        "external_image_source",
        source,
        `Images must reference an uploaded resource via data-resource; external or inline image source "${source}" is not allowed`,
      ),
    );
  }
  if (!element.hasAttribute("data-resource")) {
    out.push(
      violation(
        "image_without_resource",
        "img",
        "Images must reference an uploaded resource via the data-resource attribute",
      ),
    );
  }
}

const REFERENCE_ATTRIBUTES: ReadonlyArray<readonly [string, (value: string) => boolean]> = [
  ["data-variable", isDocumentReferenceName],
  ["data-each", isDocumentReferenceName],
  ["data-resource", isDocumentResourceKey],
];

function scanReferences(tag: string, element: ScanElement, out: DocumentViolation[]): void {
  for (const [attribute, isValid] of REFERENCE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value !== null && !isValid(value)) {
      out.push(
        violation(
          "invalid_reference_name",
          value,
          `Value "${value}" of ${attribute} on <${tag}> is not a valid name`,
        ),
      );
    }
  }
}

const EMBEDDING_TAGS: ReadonlySet<string> = new Set([
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
]);
const SVG_IMAGE_TAGS: ReadonlySet<string> = new Set(["image", "feimage", "use"]);
const URL_ATTRIBUTES = ["href", "xlink:href", "action", "formaction"] as const;

function scanEmbedding(tag: string, out: DocumentViolation[]): void {
  if (EMBEDDING_TAGS.has(tag)) {
    out.push(
      violation("embedded_content", tag, `<${tag}> elements are not allowed in template bodies`),
    );
  }
}

// html <a href> has its own rules in scanAnchor; everywhere else (svg, base,
// form controls) a URL attribute has no business in a template body.
function scanUrlAttributes(tag: string, element: ScanElement, out: DocumentViolation[]): void {
  for (const name of URL_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null || (tag === "a" && name === "href")) continue;
    if (SVG_IMAGE_TAGS.has(tag) && name.endsWith("href")) {
      out.push(
        violation(
          "external_image_source",
          value,
          `Images must reference an uploaded resource via data-resource; image source "${value}" is not allowed`,
        ),
      );
    } else if (tag === "base" || !isAllowedDocumentLinkHref(value)) {
      out.push(
        violation(
          "disallowed_link_href",
          value,
          `Link target "${value}" is not allowed; use https, http, mailto, tel or a {{placeholder}}`,
        ),
      );
    }
  }
}

// happy-dom serializes < and > inside attribute values unescaped, so a later
// parser (MJML) could read them as markup.
function scanAltText(element: ScanElement, out: DocumentViolation[]): void {
  const alt = element.getAttribute("alt");
  if (alt !== null && /[<>]/.test(alt)) {
    out.push(
      violation(
        "unsafe_attribute_value",
        alt,
        `Attribute alt must not contain "<" or ">": "${alt}"`,
      ),
    );
  }
}

function scanElement(element: ScanElement, out: DocumentViolation[]): void {
  const tag = element.tagName.toLowerCase();
  scanEmbedding(tag, out);
  scanUrlAttributes(tag, element, out);
  scanAltText(element, out);
  scanScriptAndHandlers(tag, element, out);
  if (tag === "a") scanAnchor(element, out);
  if (tag === "img") scanImage(element, out);
  scanReferences(tag, element, out);
}

function scanDocumentHtml(html: string): DocumentViolation[] {
  const window = createScanWindow();
  const violations: DocumentViolation[] = [];
  try {
    const parsed = new window.DOMParser().parseFromString(
      ["<!DOCTYPE html><html><body>", html, "</body></html>"].join(""),
      "text/html",
    );
    for (const element of Array.from(parsed.querySelectorAll("*"))) {
      scanElement(element, violations);
    }
  } finally {
    window.happyDOM.abort();
    window.happyDOM.close();
  }
  return violations;
}

// Rejects hostile constructs, then rebuilds the body from the document model.
// The rebuilt HTML is always what gets returned (never the input), so anything
// the model cannot express is dropped silently.
export function sanitizeDocumentHtml(html: string): SanitizeHtmlResult {
  const violations = scanDocumentHtml(html);
  if (violations.length > 0) return { ok: false, violations };
  return {
    ok: true,
    html: generateHTML(generateJSON(html, documentExtensions), documentExtensions),
  };
}

function isDocumentHtmlKind(kind: string): boolean {
  return (DOCUMENT_HTML_KINDS as readonly string[]).includes(kind);
}

export function sanitizeTemplateBody(input: {
  readonly kind: string;
  readonly contentFormat: ContentFormat;
  readonly content: string | null;
}): SanitizeBodyResult {
  if (input.kind === "document-pdf" && input.contentFormat !== "html") {
    return {
      ok: false,
      violations: [
        violation(
          "document_requires_html_format",
          input.contentFormat,
          `Templates of kind document-pdf require contentFormat html, got "${input.contentFormat}"`,
        ),
      ],
    };
  }
  if (!isDocumentHtmlKind(input.kind) || input.contentFormat !== "html" || input.content === null) {
    return { ok: true, content: input.content };
  }
  const result = sanitizeDocumentHtml(input.content);
  return result.ok ? { ok: true, content: result.html } : result;
}

const VIOLATION_I18N_KEYS: Readonly<Record<DocumentViolationCode, string>> = {
  script_element: "templateResolver.errors.document.scriptElement",
  event_handler_attribute: "templateResolver.errors.document.eventHandlerAttribute",
  disallowed_link_href: "templateResolver.errors.document.disallowedLinkHref",
  external_image_source: "templateResolver.errors.document.externalImageSource",
  image_without_resource: "templateResolver.errors.document.imageWithoutResource",
  invalid_reference_name: "templateResolver.errors.document.invalidReferenceName",
  embedded_content: "templateResolver.errors.document.embeddedContent",
  unsafe_attribute_value: "templateResolver.errors.document.unsafeAttributeValue",
  button_href_not_placeholder: "templateResolver.errors.document.buttonHrefNotPlaceholder",
  document_requires_html_format: "templateResolver.errors.document.documentRequiresHtmlFormat",
};

export function documentViolationsToFieldIssues(
  violations: readonly DocumentViolation[],
): FieldIssue[] {
  return violations.map((item) => ({
    path: "content",
    code: item.code,
    i18nKey: VIOLATION_I18N_KEYS[item.code],
    params: { detail: item.detail },
  }));
}
