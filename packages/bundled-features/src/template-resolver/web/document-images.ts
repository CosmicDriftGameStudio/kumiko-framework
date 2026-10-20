// The record's photos: a block bound to an `images` variable whose FileRef ids the
// app passes at render time. Universal like document-schema.ts.
import { Node } from "@tiptap/core";

export function createDocumentImagesNode(isReferenceName: (value: string) => boolean) {
  return Node.create({
    name: "images",
    group: "block",
    atom: true,
    addAttributes() {
      return { variable: { default: null } };
    },
    parseHTML() {
      return [
        {
          tag: "div[data-images]",
          getAttrs: (element) => {
            const variable = element.getAttribute("data-images");
            return variable !== null && isReferenceName(variable) ? { variable } : false;
          },
        },
      ];
    },
    renderHTML({ node }) {
      return ["div", { "data-images": node.attrs["variable"] }];
    },
  });
}
