import {
  createEntity,
  createTextField,
  defineFeature,
  registerEntityCrud,
} from "@cosmicdrift/kumiko-framework/engine";

export const pageEntity = createEntity({
  table: "read_content_pages",
  fields: {
    slug: createTextField({ required: true }),
    title: createTextField({ required: true }),
  },
});

const open = { access: { openToAll: true } } as const;

export const contentFeature = defineFeature("content", (r) => {
  registerEntityCrud(r, "page", pageEntity, {
    write: open,
    read: open,
    verbs: { update: false, delete: false, restore: false },
  });

  r.nav({
    id: "content",
    label: "Content",
    icon: "folder",
    order: 40,
    provider: true,
    createAction: {
      icon: "plus",
      label: "New page",
      target: { featureId: "content", action: "edit", args: {} },
    },
  });
});
