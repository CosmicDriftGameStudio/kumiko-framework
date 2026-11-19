import { handlerTranslationKeys } from "@cosmicdrift/kumiko-framework/engine";

type LocalizedString = { readonly en: string };

export const TAGS_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:tag-list.title": { en: "Tags" },
  "screen:tag-edit.title": { en: "Tag" },
  "tags:entity:tag:field:name": { en: "Name" },
  "tags:entity:tag:field:color": { en: "Color" },
  "tags:entity:tag:field:scope": { en: "Scope" },
};

export const TAGS_HANDLER_I18N = handlerTranslationKeys("tags", {
  writes: {
    "assign-tag": {
      title: { en: "Assign tag" },
      fields: {
        tagId: { en: "Tag" },
        entityType: { en: "Record type" },
        entityId: { en: "Record" },
      },
    },
    "remove-tag": {
      title: { en: "Remove tag" },
      fields: {
        tagId: { en: "Tag" },
        entityType: { en: "Record type" },
        entityId: { en: "Record" },
      },
    },
  },
});
