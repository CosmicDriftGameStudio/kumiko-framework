import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Extensions, NodeViewRenderer } from "@tiptap/core";
import { ListKeymap } from "@tiptap/extension-list";
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from "@tiptap/extensions";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { DocumentFrameControl } from "./document-frame-control.ts";
import { createFrameView, type FrameViewLabels } from "./document-frame-node-view.tsx";
import { DocumentPrintEditing, loadDocumentEditorFonts } from "./document-print-decorations.ts";
import { DOCUMENT_IMAGE_ALIGNMENTS, DocumentFrame } from "./document-print-style.ts";
import type { RepeatStripOptions } from "./document-repeat-strip.ts";
import {
  DOCUMENT_DATE_STYLES,
  DocumentButton,
  DocumentImages,
  DocumentPageBreak,
  DocumentResource,
  DocumentSteps,
  DocumentTable,
  DocumentVariable,
  documentExtensions,
} from "./document-schema.ts";
import { readDocumentStepsAttribute } from "./document-steps.ts";
import { documentImageCss } from "./document-style-css.ts";
import type { DocumentPrintMode, DocumentResourcePreview } from "./document-toolbar-blocks.ts";

const DOCUMENT_RESOURCE_SIZE_TOKEN = "{size}";
export const DOCUMENT_BLOCK_ATTRIBUTE = "data-document-block";

export type DocumentEditorLabels = {
  readonly placeholder: string;
  readonly image: string;
  readonly pageBreak: string;
  readonly button?: string;
  readonly steps?: string;
  readonly images?: string;
  /** Canvas block label of an image, e.g. "Image · inline". */
  readonly imageBlock?: string;
  readonly variableLabels?: Readonly<Record<string, string>>;
  readonly systemVariables?: readonly string[];
  readonly resourcePreviews?: Readonly<Record<string, DocumentResourcePreview>>;
  /** Canvas chrome labels every block with its type. */
  readonly blockLabels?: boolean;
  readonly print?: DocumentPrintMode;
  /** Tag text per frame kind; frames render as movable boxes only with these. */
  readonly frameLabels?: FrameViewLabels;
  readonly reportFrameControl?: (control: DocumentFrameControl | null) => void;
  readonly repeatStrip?: RepeatStripOptions;
};

function createElementWithClass<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const CHIP_CLASS = "mx-0.5 inline-flex items-center gap-1 rounded border px-1.5 text-[0.9em]";
const USER_CHIP_CLASS = `${CHIP_CLASS} border-primary/30 bg-primary/10 text-primary`;
const SYSTEM_CHIP_CLASS = `${CHIP_CLASS} border-input bg-muted text-muted-foreground`;

// A chip inside a repeat row names an item field; its label is registered as `list.field`.
function repeatRowListAt(doc: ProseMirrorNode, position: number | undefined): string | null {
  if (position === undefined) return null;
  const resolved = doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth--) {
    const each: unknown = resolved.node(depth).attrs["each"];
    if (typeof each === "string" && each !== "") return each;
  }
  return null;
}

// Language-neutral: the real value is formatted per locale at render time.
const DATE_STYLE_CHIP_HINTS = { short: "15.01.2026", long: "15. Jan 2026" } as const;

// The chip is display only: the stored node carries just the name, so a
// label never reaches the document.
export function createVariableView(
  variableLabels: Readonly<Record<string, string>>,
  systemVariables: readonly string[],
): NodeViewRenderer {
  return ({ node, editor, getPos }) => {
    const name = String(node.attrs["name"]);
    const listName = repeatRowListAt(editor.state.doc, getPos());
    const labelKey = listName === null ? name : `${listName}.${name}`;
    const label = Object.hasOwn(variableLabels, labelKey) ? variableLabels[labelKey] : undefined;
    const dom = createElementWithClass(
      "span",
      systemVariables.includes(name) ? SYSTEM_CHIP_CLASS : USER_CHIP_CLASS,
    );
    dom.contentEditable = "false";
    dom.setAttribute("data-variable-chip", "");
    const hasOwnLabel = label !== undefined && label !== "" && label !== name;
    dom.append(document.createTextNode(hasOwnLabel ? label : name));
    if (hasOwnLabel) dom.title = name;
    const dateStyle: unknown = node.attrs["dateStyle"];
    if (isOneOf(DOCUMENT_DATE_STYLES, dateStyle)) {
      dom.setAttribute("data-date-style", dateStyle);
      dom.append(document.createTextNode(` · ${DATE_STYLE_CHIP_HINTS[dateStyle]}`));
    }
    return { dom };
  };
}

// Same rule the sanitizer's image handling follows: previews never carry a
// scriptable scheme.
const PREVIEW_SRC = /^(data:image\/(png|jpeg|gif|webp);|blob:|https:\/\/|\/)/;

function createBlockLabel(text: string): HTMLSpanElement {
  const label = createElementWithClass(
    "span",
    "absolute -top-2 left-2 bg-card px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
    text,
  );
  label.contentEditable = "false";
  return label;
}

type ResourcePreview = NonNullable<DocumentEditorLabels["resourcePreviews"]>[string];

function appendResourceImage(
  dom: HTMLElement,
  node: ProseMirrorNode,
  key: string,
  preview: ResourcePreview,
): void {
  const widthMm = node.attrs["widthMm"];
  const align = node.attrs["align"];
  const sized = typeof widthMm === "number";
  const bleeds = node.attrs["bleed"] === true;
  const image = createElementWithClass(
    "img",
    sized || bleeds ? "rounded" : "max-w-[180px] rounded",
  );
  // The same builder as the PDF, so the editor size follows the paper scale.
  image.style.cssText = documentImageCss({
    widthMm: typeof widthMm === "number" ? widthMm : null,
    align: isOneOf(DOCUMENT_IMAGE_ALIGNMENTS, align) ? align : null,
  });
  if (bleeds) image.style.width = "100%";
  if (sized || bleeds) dom.style.display = "block";
  image.src = preview.src;
  image.alt = typeof node.attrs["alt"] === "string" ? node.attrs["alt"] : key;
  dom.append(image);
  // An empty caption means "no caption", not the key.
  const caption = preview.caption ?? key;
  if (caption !== "") {
    const captionElement = createElementWithClass(
      "span",
      "whitespace-nowrap text-[11px]",
      caption.replace(` · ${DOCUMENT_RESOURCE_SIZE_TOKEN}`, ""),
    );
    // The size is only known once the browser decoded the image (possibly already, from cache).
    const showSize = (): void => {
      captionElement.textContent = caption.replace(
        DOCUMENT_RESOURCE_SIZE_TOKEN,
        `${image.naturalWidth} × ${image.naturalHeight} px`,
      );
    };
    image.addEventListener("load", showSize);
    if (image.complete && image.naturalWidth > 0) showSize();
    dom.append(captionElement);
  }
}

function createResourceView(labels: DocumentEditorLabels): NodeViewRenderer {
  return ({ node }) => {
    const key = String(node.attrs["resource"]);
    const previews = labels.resourcePreviews ?? {};
    const preview = Object.hasOwn(previews, key) ? previews[key] : undefined;
    const hasImage = preview !== undefined && PREVIEW_SRC.test(preview.src);
    // A rendered image needs no frame until the node is selected (ProseMirror marks it).
    const dom = createElementWithClass(
      "div",
      hasImage
        ? "relative my-1 flex items-center gap-2 rounded border border-transparent px-2 py-1 text-sm text-muted-foreground [.ProseMirror-focused_&.ProseMirror-selectednode]:border-dashed [.ProseMirror-focused_&.ProseMirror-selectednode]:border-input"
        : "relative my-3 flex items-center gap-3 rounded border border-dashed border-input px-3 py-3 text-sm text-muted-foreground",
    );
    dom.setAttribute(DOCUMENT_BLOCK_ATTRIBUTE, "");
    dom.contentEditable = "false";
    if (labels.blockLabels) {
      const label = createBlockLabel(labels.imageBlock ?? labels.image);
      if (hasImage)
        label.classList.add("hidden", "[.ProseMirror-focused_.ProseMirror-selectednode_&]:block");
      dom.append(label);
    }
    if (hasImage) {
      appendResourceImage(dom, node, key, preview);
    } else {
      dom.append(
        createElementWithClass("span", "font-medium", labels.image),
        createElementWithClass("code", "text-xs", key),
      );
    }
    return { dom };
  };
}

function createButtonView(buttonLabel: string): NodeViewRenderer {
  return () => {
    const dom = createElementWithClass(
      "div",
      "relative my-3 rounded border border-dashed border-input p-3",
    );
    dom.setAttribute(DOCUMENT_BLOCK_ATTRIBUTE, "");
    const button = document.createElement("a");
    button.setAttribute("data-button", "");
    dom.append(createBlockLabel(buttonLabel), button);
    return { dom, contentDOM: button };
  };
}

function createPageBreakView(pageBreakLabel: string): NodeViewRenderer {
  return () => {
    const dom = createElementWithClass(
      "div",
      "my-3 border-t border-dashed border-input pt-1 text-center text-xs uppercase tracking-wide text-muted-foreground",
      pageBreakLabel,
    );
    dom.contentEditable = "false";
    return { dom };
  };
}

// A static sketch of the row: which stage is reached is only known at render time.
function createStepsView(labels: DocumentEditorLabels): NodeViewRenderer {
  return ({ node }) => {
    const dom = createElementWithClass(
      "div",
      "relative my-3 rounded border border-dashed border-input px-3 pb-2 pt-3",
    );
    dom.setAttribute(DOCUMENT_BLOCK_ATTRIBUTE, "");
    dom.contentEditable = "false";
    const variable = String(node.attrs["variable"]);
    const variableLabels = labels.variableLabels ?? {};
    const variableLabel = Object.hasOwn(variableLabels, variable)
      ? variableLabels[variable]
      : undefined;
    dom.append(createBlockLabel(`${labels.steps ?? "Steps"} · ${variableLabel ?? variable}`));
    const row = createElementWithClass("div", "flex gap-1.5");
    for (const step of readDocumentStepsAttribute(node.attrs["steps"])) {
      const cell = createElementWithClass("div", "min-w-0 flex-1");
      cell.append(
        createElementWithClass("div", "h-1 rounded-full bg-primary/40"),
        createElementWithClass("div", "truncate pt-1.5 text-xs text-muted-foreground", step.label),
      );
      row.append(cell);
    }
    dom.append(row);
    return { dom };
  };
}

// A sketch only: the photos are record data, known at render time.
function createImagesView(labels: DocumentEditorLabels): NodeViewRenderer {
  return ({ node }) => {
    const dom = createElementWithClass(
      "div",
      "relative my-3 rounded border border-dashed border-input px-3 pb-3 pt-4",
    );
    dom.setAttribute(DOCUMENT_BLOCK_ATTRIBUTE, "");
    dom.contentEditable = "false";
    const variable = String(node.attrs["variable"]);
    const variableLabels = labels.variableLabels ?? {};
    const variableLabel = Object.hasOwn(variableLabels, variable)
      ? variableLabels[variable]
      : undefined;
    dom.append(createBlockLabel(`${labels.images ?? "Photos"} · ${variableLabel ?? variable}`));
    const grid = createElementWithClass("div", "grid grid-cols-2 gap-1.5");
    grid.append(
      createElementWithClass("div", "h-12 rounded bg-muted"),
      createElementWithClass("div", "h-12 rounded bg-muted"),
    );
    dom.append(grid);
    return { dom };
  };
}

// Replaced by name, not appended: the schema must keep exactly one node per
// name, and only the editor view differs from the shared document schema.
export function createDocumentEditorExtensions(labels: DocumentEditorLabels): Extensions {
  const base = documentExtensions.map((extension) => {
    switch (extension.name) {
      case DocumentVariable.name:
        return DocumentVariable.extend({
          addNodeView: () =>
            createVariableView(labels.variableLabels ?? {}, labels.systemVariables ?? []),
        });
      case DocumentResource.name:
        return DocumentResource.extend({ addNodeView: () => createResourceView(labels) });
      case DocumentButton.name:
        return labels.blockLabels
          ? DocumentButton.extend({ addNodeView: () => createButtonView(labels.button ?? "") })
          : extension;
      case DocumentSteps.name:
        return DocumentSteps.extend({ addNodeView: () => createStepsView(labels) });
      case DocumentImages.name:
        return DocumentImages.extend({ addNodeView: () => createImagesView(labels) });
      case DocumentTable.name:
        return labels.print !== undefined && labels.print !== "none"
          ? DocumentTable.configure({ resizable: true })
          : extension;
      case DocumentFrame.name: {
        const { frameLabels } = labels;
        return frameLabels === undefined
          ? extension
          : DocumentFrame.extend({ addNodeView: () => createFrameView(frameLabels) });
      }
      case DocumentPageBreak.name:
        return DocumentPageBreak.extend({
          addNodeView: () => createPageBreakView(labels.pageBreak),
        });
      default:
        return extension;
    }
  });
  const print = labels.print ?? "none";
  if (print !== "none") void loadDocumentEditorFonts();
  // No TrailingNode: it appends an empty paragraph that breaks the HTML roundtrip.
  return [
    ...base,
    ...(print === "none"
      ? []
      : [
          DocumentPrintEditing.configure({
            frames: print === "page",
            reportFrameControl: labels.reportFrameControl ?? null,
            repeatStrip: labels.repeatStrip ?? null,
          }),
        ]),
    UndoRedo,
    Gapcursor,
    Dropcursor,
    ListKeymap,
    Placeholder.configure({ placeholder: labels.placeholder }),
  ];
}
