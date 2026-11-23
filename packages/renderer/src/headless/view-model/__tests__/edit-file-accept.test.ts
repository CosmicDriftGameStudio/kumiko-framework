import { expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { DEFAULT_IMAGE_FIELD_ACCEPT } from "@cosmicdrift/kumiko-types/file-field-accept";
import { computeEditViewModel } from "../edit.ts";

test("accept falls back to the image default, stays empty for accept [] and absent on file fields", () => {
  const entity = {
    fields: {
      avatar: { type: "image" },
      gallery: { type: "images" },
      anything: { type: "image", accept: [] },
      doc: { type: "file" },
    },
  } as unknown as EntityDefinition;
  const vm = computeEditViewModel({
    screen: {
      id: "orders:screen:order-edit",
      type: "entityEdit",
      entity: "order",
      layout: { sections: [{ title: "x", fields: ["avatar", "gallery", "anything", "doc"] }] },
    },
    entity,
    values: {},
    translate: (key: string) => key,
    featureName: "orders",
  });
  const section = vm.sections[0];
  if (section?.kind !== "fields") throw new Error("expected a fields section");
  const [avatar, gallery, anything, doc] = section.fields;
  expect(avatar?.accept).toEqual([...DEFAULT_IMAGE_FIELD_ACCEPT]);
  expect(gallery?.accept).toEqual([...DEFAULT_IMAGE_FIELD_ACCEPT]);
  expect(anything?.accept).toEqual([]);
  expect(doc?.accept).toBeUndefined();
});
