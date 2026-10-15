// Server-only (happy-dom). A structured layout is the editable frame around a
// mail or PDF body: header, signature and footer regions plus one empty
// content slot. Everything else is rejected so a layout can never carry markup
// the renderer did not plan for.

import type { Element as ScanElement } from "happy-dom";
import type { ContentFormat } from "./constants.js";
import {
  type DocumentViolation,
  type SanitizeBodyResult,
  sanitizeDocumentHtml,
  sanitizeTemplateBody,
  violation,
  withParsedDocument,
} from "./document-sanitizer.js";

const REGION_ATTRIBUTES = ["data-header", "data-content", "data-signature", "data-footer"] as const;
type RegionAttribute = (typeof REGION_ATTRIBUTES)[number];

const MAIL_LAYOUT_CONTENT_SLOT = /\{\{\{\s*content\s*\}\}\}/g;

export type LayoutRegions = {
  readonly header: string;
  readonly signature: string;
  readonly footer: string;
};

export type SanitizeLayoutResult =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly violations: readonly DocumentViolation[] };

type ParsedRegions = {
  readonly innerHtml: Partial<Record<RegionAttribute, string>>;
  readonly contentIsEmpty: boolean;
  readonly violations: DocumentViolation[];
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

function regionAttributeOf(element: ScanElement): RegionAttribute | null {
  if (element.tagName.toLowerCase() !== "div") return null;
  const present = REGION_ATTRIBUTES.filter((name) => element.hasAttribute(name));
  return present.length === 1 ? (present[0] ?? null) : null;
}

function parseRegions(html: string): ParsedRegions {
  return withParsedDocument(html, (body) => {
    const innerHtml: Partial<Record<RegionAttribute, string>> = {};
    const violations: DocumentViolation[] = [];
    let contentIsEmpty = true;
    const invalid = (detail: string, message: string) =>
      violations.push(violation("layout_invalid_structure", detail, message));
    for (const node of Array.from(body.childNodes)) {
      if (node.nodeType === ELEMENT_NODE) continue;
      if (node.nodeType !== TEXT_NODE || (node.textContent ?? "").trim() !== "") {
        invalid("text", "Text and comments outside the layout regions are not allowed");
      }
    }
    for (const element of Array.from(body.children)) {
      const region = regionAttributeOf(element);
      if (region === null) {
        invalid(
          element.tagName.toLowerCase(),
          "Only <div data-header>, <div data-content>, <div data-signature> and <div data-footer> are allowed at the top level",
        );
        continue;
      }
      if (innerHtml[region] !== undefined) {
        invalid(region, `Layout region ${region} may appear only once`);
        continue;
      }
      innerHtml[region] = element.innerHTML;
      if (region === "data-content") {
        contentIsEmpty = element.children.length === 0 && (element.textContent ?? "").trim() === "";
      }
    }
    return { innerHtml, contentIsEmpty, violations };
  });
}

export function sanitizeLayoutHtml(html: string): SanitizeLayoutResult {
  const parsed = parseRegions(html);
  const violations = [...parsed.violations];
  if (parsed.innerHtml["data-content"] === undefined) {
    violations.push(
      violation(
        "layout_missing_content_slot",
        "data-content",
        "A layout needs exactly one empty <div data-content></div> where the body is placed",
      ),
    );
  } else if (!parsed.contentIsEmpty) {
    violations.push(
      violation(
        "layout_invalid_structure",
        "data-content",
        "The data-content region must be empty",
      ),
    );
  }
  const cleanedHtml: Partial<Record<RegionAttribute, string>> = {};
  for (const name of ["data-header", "data-signature", "data-footer"] as const) {
    const inner = parsed.innerHtml[name];
    if (inner === undefined || inner.trim() === "") continue;
    const result = sanitizeDocumentHtml(inner);
    if (result.ok) cleanedHtml[name] = result.html;
    else violations.push(...result.violations);
  }
  if (violations.length > 0) return { ok: false, violations };
  const part = (name: RegionAttribute) => {
    const regionHtml = cleanedHtml[name];
    return regionHtml === undefined ? "" : `<div ${name}>${regionHtml}</div>`;
  };
  return {
    ok: true,
    html: [
      part("data-header"),
      "<div data-content></div>",
      part("data-signature"),
      part("data-footer"),
    ].join(""),
  };
}

export function readLayoutRegions(html: string): LayoutRegions {
  const { innerHtml } = parseRegions(html);
  return {
    header: innerHtml["data-header"] ?? "",
    signature: innerHtml["data-signature"] ?? "",
    footer: innerHtml["data-footer"] ?? "",
  };
}

export type TemplateWriteScope = "system" | "tenant";

function rejected(violationItem: DocumentViolation): SanitizeBodyResult {
  return { ok: false, violations: [violationItem] };
}

function sanitizeMailLayout(
  scope: TemplateWriteScope,
  contentFormat: ContentFormat,
  content: string,
): SanitizeBodyResult {
  if (contentFormat === "html") return fromLayoutResult(sanitizeLayoutHtml(content));
  if (contentFormat !== "mjml") {
    return rejected(
      violation(
        "layout_requires_mjml_format",
        contentFormat,
        `Templates of kind mail-layout require contentFormat mjml or html, got "${contentFormat}"`,
      ),
    );
  }
  if (scope !== "system") {
    return rejected(
      violation(
        "layout_source_system_only",
        "mjml",
        "Only system layouts may use mjml source; tenant layouts use the structured html format",
      ),
    );
  }
  if ((content.match(MAIL_LAYOUT_CONTENT_SLOT) ?? []).length !== 1) {
    return rejected(
      violation(
        "layout_missing_content_slot",
        "{{{content}}}",
        "A mjml layout must contain {{{content}}} exactly once",
      ),
    );
  }
  return { ok: true, content };
}

function fromLayoutResult(result: SanitizeLayoutResult): SanitizeBodyResult {
  return result.ok ? { ok: true, content: result.html } : result;
}

// One entry for every write path: layout kinds follow the scope-dependent
// layout rules, everything else the plain document sanitizer.
export function sanitizeTemplateWriteBody(input: {
  readonly kind: string;
  readonly scope: TemplateWriteScope;
  readonly contentFormat: ContentFormat;
  readonly content: string | null;
}): SanitizeBodyResult {
  const { kind, scope, contentFormat, content } = input;
  if (kind === "mail-layout" && content !== null) {
    return sanitizeMailLayout(scope, contentFormat, content);
  }
  if (kind === "pdf-layout" && content !== null) {
    if (contentFormat !== "html") {
      return rejected(
        violation(
          "document_requires_html_format",
          contentFormat,
          `Templates of kind pdf-layout require contentFormat html, got "${contentFormat}"`,
        ),
      );
    }
    return fromLayoutResult(sanitizeLayoutHtml(content));
  }
  return sanitizeTemplateBody({ kind, contentFormat, content });
}
