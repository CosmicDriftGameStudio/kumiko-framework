// @runtime client
import type { Extensions, NodeViewRenderer } from "@tiptap/core";
import { ListKeymap } from "@tiptap/extension-list";
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from "@tiptap/extensions";
import {
  DocumentButton,
  DocumentPageBreak,
  DocumentResource,
  DocumentVariable,
  documentExtensions,
} from "../document-schema.js";
import type { DocumentResourcePreview } from "./document-toolbar-blocks.js";

export type DocumentEditorLabels = {
  readonly placeholder: string;
  readonly image: string;
  readonly pageBreak: string;
  readonly button?: string;
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

// The chip is display only: the stored node carries just the name, so a
// label never reaches the document.
export function createVariableView(
  variableLabels: Readonly<Record<string, string>>,
  systemVariables: readonly string[],
): NodeViewRenderer {
  return ({ node }) => {
    const name = String(node.attrs["name"]);
    const label = Object.hasOwn(variableLabels, name) ? variableLabels[name] : undefined;
    const dom = createElementWithClass(
      "span",
      systemVariables.includes(name) ? SYSTEM_CHIP_CLASS : USER_CHIP_CLASS,
    );
    dom.contentEditable = "false";
    dom.append(document.createTextNode(label !== undefined && label !== "" ? label : name));
    if (label !== undefined && label !== "" && label !== name) {
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
    const dom = createElementWithClass(
      "div",
      "relative my-3 flex items-center gap-3 rounded border border-dashed border-input px-3 py-3 text-sm text-muted-foreground",
    );
    dom.contentEditable = "false";
    if (labels.blockLabels) dom.append(createBlockLabel(labels.image));
    if (preview !== undefined && PREVIEW_SRC.test(preview.src)) {
      const image = createElementWithClass("img", "max-h-16 max-w-48 rounded");
      image.src = preview.src;
      image.alt = typeof node.attrs["alt"] === "string" ? node.attrs["alt"] : key;
      dom.append(image);
      dom.append(createElementWithClass("span", "text-xs", preview.caption ?? key));
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
      "my-3 border-t border-dashed border-input pt-1 text-center text-xs text-muted-foreground",
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
            createVariableView(labels.variableLabels ?? {}, labels.systemVariables ?? []),
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
