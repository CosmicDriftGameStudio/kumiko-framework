// @runtime client
import type { Extensions, NodeViewRenderer } from "@tiptap/core";
import { ListKeymap } from "@tiptap/extension-list";
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from "@tiptap/extensions";
import {
  DocumentPageBreak,
  DocumentResource,
  DocumentVariable,
  documentExtensions,
} from "../document-schema.js";

export type DocumentEditorLabels = {
  readonly placeholder: string;
  readonly image: string;
  readonly pageBreak: string;
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

const variableView: NodeViewRenderer = ({ node }) => {
  const dom = createElementWithClass(
    "span",
    "mx-0.5 inline-block rounded border border-input bg-muted px-1.5 py-0.5 text-xs text-muted-foreground",
    String(node.attrs["name"]),
  );
  dom.contentEditable = "false";
  return { dom };
};

function createResourceView(imageLabel: string): NodeViewRenderer {
  return ({ node }) => {
    const dom = createElementWithClass(
      "div",
      "my-2 flex items-center gap-2 rounded border border-input bg-muted px-3 py-2 text-sm text-muted-foreground",
    );
    dom.contentEditable = "false";
    dom.append(
      createElementWithClass("span", "font-medium", imageLabel),
      createElementWithClass("code", "text-xs", String(node.attrs["resource"])),
    );
    return { dom };
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
        return DocumentVariable.extend({ addNodeView: () => variableView });
      case DocumentResource.name:
        return DocumentResource.extend({ addNodeView: () => createResourceView(labels.image) });
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
