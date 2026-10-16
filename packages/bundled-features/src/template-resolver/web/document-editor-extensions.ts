// @runtime client
import type { Extensions, NodeViewRenderer } from "@tiptap/core";
import { ListKeymap } from "@tiptap/extension-list";
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from "@tiptap/extensions";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  DocumentButton,
  DocumentPageBreak,
  DocumentResource,
  DocumentVariable,
  documentExtensions,
} from "../document-schema.js";
import type { DocumentResourcePreview } from "./document-toolbar-blocks.js";

const DOCUMENT_RESOURCE_SIZE_TOKEN = "{size}";
export const DOCUMENT_BLOCK_ATTRIBUTE = "data-document-block";

export type DocumentEditorLabels = {
  readonly placeholder: string;
  readonly image: string;
  readonly pageBreak: string;
  readonly button?: string;
  /** Canvas block label of an image, e.g. "Image · inline". */
  readonly imageBlock?: string;
  readonly variableLabels?: Readonly<Record<string, string>>;
  readonly systemVariables?: readonly string[];
  readonly resourcePreviews?: Readonly<Record<string, DocumentResourcePreview>>;
  /** Canvas chrome labels every block with its type. */
  readonly blockLabels?: boolean;
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

const CHIP_CLASS = "mx-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs";
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

// The chip is display only: the stored node carries just the name, so a
// label never reaches the document.
export function createVariableView(
  variableLabels: Readonly<Record<string, string>>,
  systemVariables: readonly string[],
  labelOnly = false,
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
    dom.append(document.createTextNode(label !== undefined && label !== "" ? label : name));
    if (!labelOnly && label !== undefined && label !== "" && label !== name) {
      dom.append(createElementWithClass("small", "font-mono text-[10px] opacity-75", name));
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
      const image = createElementWithClass("img", "max-w-[180px] rounded");
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

// Replaced by name, not appended: the schema must keep exactly one node per
// name, and only the editor view differs from the shared document schema.
export function createDocumentEditorExtensions(labels: DocumentEditorLabels): Extensions {
  const base = documentExtensions.map((extension) => {
    switch (extension.name) {
      case DocumentVariable.name:
        return DocumentVariable.extend({
          addNodeView: () =>
            createVariableView(
              labels.variableLabels ?? {},
              labels.systemVariables ?? [],
              labels.blockLabels === true,
            ),
        });
      case DocumentResource.name:
        return DocumentResource.extend({ addNodeView: () => createResourceView(labels) });
      case DocumentButton.name:
        return labels.blockLabels
          ? DocumentButton.extend({ addNodeView: () => createButtonView(labels.button ?? "") })
          : extension;
      case DocumentPageBreak.name:
        return DocumentPageBreak.extend({
          addNodeView: () => createPageBreakView(labels.pageBreak),
        });
      default:
        return extension;
    }
  });
  // No TrailingNode: it appends an empty paragraph that breaks the HTML roundtrip.
  return [
    ...base,
    UndoRedo,
    Gapcursor,
    Dropcursor,
    ListKeymap,
    Placeholder.configure({ placeholder: labels.placeholder }),
  ];
}
