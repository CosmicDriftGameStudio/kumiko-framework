// The record's photos: a block bound to an `images` variable whose FileRef ids the
// app passes at render time. Universal like document-schema.ts.

import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { Node } from "@tiptap/core";

export const DOCUMENT_IMAGE_COLUMNS = ["1", "2", "3"] as const;

export type DocumentImageColumns = (typeof DOCUMENT_IMAGE_COLUMNS)[number];

export function readDocumentImageColumns(value: unknown): DocumentImageColumns | null {
  return isOneOf(DOCUMENT_IMAGE_COLUMNS, value) ? value : null;
}

export function createDocumentImagesNode(isReferenceName: (value: string) => boolean) {
  return Node.create({
    name: "images",
    group: "block",
    atom: true,
    addAttributes() {
      return { variable: { default: null }, columns: { default: null } };
    },
    parseHTML() {
      return [
        {
          tag: "div[data-images]",
          getAttrs: (element) => {
            const variable = element.getAttribute("data-images");
            if (variable === null || !isReferenceName(variable)) return false;
            return {
              variable,
              columns: readDocumentImageColumns(element.getAttribute("data-image-columns")),
            };
          },
        },
      ];
    },
    renderHTML({ node }) {
      const columns = readDocumentImageColumns(node.attrs["columns"]);
      return [
        "div",
        {
          "data-images": node.attrs["variable"],
          ...(columns !== null && { "data-image-columns": columns }),
        },
      ];
    },
  });
}
