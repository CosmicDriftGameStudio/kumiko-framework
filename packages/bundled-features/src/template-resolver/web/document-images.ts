// The record's photos: a block bound to an `images` variable whose FileRef ids the
// app passes at render time. Universal like document-schema.ts.
import { Node } from "@tiptap/core";
import { attributeParseRule } from "./tiptap-attribute-parse-rule.ts";

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
        attributeParseRule({
          tag: "div[data-images]",
          attribute: "data-images",
          key: "variable",
          isValid: isReferenceName,
        }),
      ];
    },
    renderHTML({ node }) {
      return ["div", { "data-images": node.attrs["variable"] }];
    },
  });
}
