// Canonical document model for template bodies (kinds mail, document-pdf).
// Universal on purpose: the web editor and the server sanitizer load the same
// extension list, so what the editor can produce is exactly what the server
// keeps. No DOM access at module level, no happy-dom here.
import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { Extension, type Extensions, Node } from "@tiptap/core";
import { Link } from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { createDocumentImagesNode } from "./document-images.ts";
import { isDocumentReferenceName } from "./document-reference-name.ts";
import { createDocumentStepsNode } from "./document-steps.ts";

const PLACEHOLDER_HREF = /^\{\{(.+)\}\}$/;
const RESOURCE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const ALLOWED_LINK_SCHEMES = ["https://", "http://", "mailto:", "tel:"] as const;

export { isDocumentReferenceName };

export function isDocumentPlaceholderHref(href: string): boolean {
  const name = PLACEHOLDER_HREF.exec(href)?.[1];
  return name !== undefined && isDocumentReferenceName(name);
}

const UNSAFE_URL_CHARACTERS = new Set(["<", ">", '"']);

function hasUnsafeUrlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return UNSAFE_URL_CHARACTERS.has(character) || code <= 0x1f || code === 0x7f;
  });
}

function isParsableWebUrl(href: string, protocol: "https:" | "http:"): boolean {
  try {
    return new URL(href).protocol === protocol;
  } catch {
    return false;
  }
}

function hasAllowedLinkScheme(href: string): boolean {
  if (href.startsWith("https://")) return isParsableWebUrl(href, "https:");
  if (href.startsWith("http://")) return isParsableWebUrl(href, "http:");
  return ALLOWED_LINK_SCHEMES.some((scheme) => href.startsWith(scheme));
}

// Relative references are matched by their literal leading character so a
// scheme can never hide in them: a value starting with a letter ("x:y",
// "javascript:") is not relative. Protocol-relative "//host" and any backslash
// (browsers read "/\\host" as "//host") would leave the site.
const RELATIVE_HREF_PREFIXES = ["/", "./", "../", "#", "?"] as const;

function isRelativeHref(href: string): boolean {
  if (href.includes("\\") || href.startsWith("//")) return false;
  return RELATIVE_HREF_PREFIXES.some((prefix) => href.startsWith(prefix));
}

// Exact lowercase prefix on the unchanged value: no trim, no case folding, so
// "JaVaScRiPt:", "HTTPS://" or a leading tab can never slip through as a
// scheme variant. Markup and control characters are refused outright because
// downstream parsers (MJML, PDF renderer) re-read the serialized attribute.
export function isAllowedDocumentLinkHref(href: string): boolean {
  if (hasUnsafeUrlCharacter(href)) return false;
  return hasAllowedLinkScheme(href) || isRelativeHref(href) || isDocumentPlaceholderHref(href);
}

export function isDocumentResourceKey(value: string): boolean {
  return RESOURCE_KEY.test(value);
}

export const DOCUMENT_NODE_NAMES = [
  "variable",
  "resource",
  "button",
  "divider",
  "pageBreak",
  "steps",
  "images",
] as const;

export const DocumentVariable = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { name: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-variable]",
        getAttrs: (element) => {
          const name = element.getAttribute("data-variable");
          return name !== null && isDocumentReferenceName(name) ? { name } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return ["span", { "data-variable": node.attrs["name"] }];
  },
});

export const DocumentResource = Node.create({
  name: "resource",
  group: "block",
  atom: true,
  addAttributes() {
    return { resource: { default: null }, alt: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "img[data-resource]",
        getAttrs: (element) => {
          const resource = element.getAttribute("data-resource");
          if (resource === null || !isDocumentResourceKey(resource)) return false;
          return { resource, alt: element.getAttribute("alt") };
        },
      },
    ];
  },
  // Never emits src: the renderer resolves the resource key at render time.
  renderHTML({ node }) {
    const alt = node.attrs["alt"];
    return [
      "img",
      alt === null || alt === undefined
        ? { "data-resource": node.attrs["resource"] }
        : { "data-resource": node.attrs["resource"], alt },
    ];
  },
});

export const DocumentButton = Node.create({
  name: "button",
  group: "block",
  // A placeholder in the label ("View {{pageName}}") must survive the round trip.
  content: "(text | variable)*",
  marks: "",
  defining: true,
  addAttributes() {
    return { href: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-button]",
        // Must win against the Link mark's `a[href]` rule.
        priority: 1000,
        getAttrs: (element) => {
          const href = element.getAttribute("href");
          return href !== null && isDocumentPlaceholderHref(href) ? { href } : false;
        },
      },
    ];
  },
  renderHTML({ node }) {
    return ["a", { "data-button": "", href: node.attrs["href"] }, 0];
  },
});

export const DocumentDivider = Node.create({
  name: "divider",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "hr" }];
  },
  renderHTML() {
    return ["hr"];
  },
});

export const DocumentPageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML() {
    return ["div", { "data-page-break": "" }];
  },
});

export const DocumentSteps = createDocumentStepsNode(isDocumentReferenceName);

export const DocumentImages = createDocumentImagesNode(isDocumentReferenceName);

// A repeat row is a table row carrying `each`: prosemirror-tables requires
// the tableRow node type, so a separate node type is not an option.
export const DocumentTableRow = TableRow.extend({
  addAttributes() {
    return {
      each: {
        default: null,
        parseHTML: (element) => {
          const each = element.getAttribute("data-each");
          return each !== null && isDocumentReferenceName(each) ? each : null;
        },
        renderHTML: (attributes) => {
          const each: unknown = attributes["each"];
          return typeof each === "string" && each ? { "data-each": each } : {};
        },
      },
      repeatHeader: {
        default: false,
        parseHTML: (element) => element.hasAttribute("data-repeat-header"),
        renderHTML: (attributes) =>
          attributes["repeatHeader"] ? { "data-repeat-header": "" } : {},
      },
    };
  },
});

export const DocumentTable = Table.extend({
  renderHTML() {
    return ["table", ["tbody", 0]];
  },
});

// Span attributes are rendered only when they differ from the default, and
// colwidth (an editor-resize artefact) never, so `<td><p>x</p></td>` is the
// canonical cell.
function plainObjectOrEmpty(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function canonicalCellAttributes(attributes: Record<string, unknown>) {
  return {
    ...attributes,
    colspan: {
      ...plainObjectOrEmpty(attributes["colspan"]),
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs["colspan"] && attrs["colspan"] !== 1 ? { colspan: attrs["colspan"] } : {},
    },
    rowspan: {
      ...plainObjectOrEmpty(attributes["rowspan"]),
      renderHTML: (attrs: Record<string, unknown>) =>
        attrs["rowspan"] && attrs["rowspan"] !== 1 ? { rowspan: attrs["rowspan"] } : {},
    },
    colwidth: {
      ...plainObjectOrEmpty(attributes["colwidth"]),
      renderHTML: () => ({}),
    },
  };
}

export const DocumentTableCell = TableCell.extend({
  addAttributes() {
    return canonicalCellAttributes(this.parent?.() ?? {});
  },
});

export const DocumentTableHeader = TableHeader.extend({
  addAttributes() {
    return canonicalCellAttributes(this.parent?.() ?? {});
  },
});

// Only href survives a parse: target, rel, class and title from the input would
// otherwise be kept verbatim, and the renderer decides those itself.
export const DocumentLink = Link.extend({
  addAttributes() {
    return { href: { default: null, parseHTML: (element) => element.getAttribute("href") } };
  },
});

export const DOCUMENT_TEXT_ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export type DocumentTextAlignment = (typeof DOCUMENT_TEXT_ALIGNMENTS)[number];

// Serialized as data-align, never as a style attribute: the sanitizer keeps
// styles out of the model, and each renderer maps the value to its own CSS.
export const DocumentTextAlign = Extension.create({
  name: "documentTextAlign",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => {
              const align = element.getAttribute("data-align");
              return isOneOf(DOCUMENT_TEXT_ALIGNMENTS, align) ? align : null;
            },
            renderHTML: (attributes) => {
              const align: unknown = attributes["textAlign"];
              return isOneOf(DOCUMENT_TEXT_ALIGNMENTS, align) ? { "data-align": align } : {};
            },
          },
        },
      },
    ];
  },
});

// Only "small" exists: the sender line above an address block. Serialized as data-size for the
// same reason as data-align.
export const DocumentTextSize = Extension.create({
  name: "documentTextSize",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          textSize: {
            default: null,
            parseHTML: (element) =>
              element.getAttribute("data-size") === "small" ? "small" : null,
            renderHTML: (attributes) =>
              attributes["textSize"] === "small" ? { "data-size": "small" } : {},
          },
        },
      },
    ];
  },
});

// A block shown only when the named variable has a value (data-if, the
// conditional counterpart of data-each). Table rows qualify so an invoice can
// drop a discount line; tiptap merges the attribute into paragraph, heading
// and row markup only.
export const DOCUMENT_CONDITION_ATTRIBUTE = "data-if";

export const DocumentCondition = Extension.create({
  name: "documentCondition",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading", "tableRow"],
        attributes: {
          showIf: {
            default: null,
            parseHTML: (element) => {
              const name = element.getAttribute(DOCUMENT_CONDITION_ATTRIBUTE);
              return name !== null && isDocumentReferenceName(name) ? name : null;
            },
            renderHTML: (attributes) => {
              const name: unknown = attributes["showIf"];
              return typeof name === "string" && isDocumentReferenceName(name)
                ? { [DOCUMENT_CONDITION_ATTRIBUTE]: name }
                : {};
            },
          },
        },
      },
    ];
  },
});

export const documentExtensions: Extensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    strike: false,
    horizontalRule: false,
    dropcursor: false,
    gapcursor: false,
    undoRedo: false,
    trailingNode: false,
    listKeymap: false,
    heading: { levels: [1, 2, 3] },
    link: false,
  }),
  DocumentLink.configure({
    openOnClick: false,
    autolink: false,
    linkOnPaste: false,
    HTMLAttributes: { target: null, rel: null, class: null },
    isAllowedUri: (url) => isAllowedDocumentLinkHref(url),
  }),
  DocumentTable,
  DocumentTableRow,
  DocumentTableHeader,
  DocumentTableCell,
  DocumentVariable,
  DocumentResource,
  DocumentButton,
  DocumentDivider,
  DocumentPageBreak,
  DocumentSteps,
  DocumentImages,
  DocumentTextAlign,
  DocumentTextSize,
  DocumentCondition,
];
