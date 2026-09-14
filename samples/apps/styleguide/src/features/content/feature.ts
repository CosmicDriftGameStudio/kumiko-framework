import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const pageEntity = createEntity({
  table: "read_content_pages",
  fields: {
    slug: createTextField({ required: true }),
    title: createTextField({ required: true }),
  },
});

const CONTENT_MANAGE_OPEN_REASON =
  "demo app: any signed-in user manages every content page; there is no per-user ownership in this sample";

const open = {
  access: {
    openToAll: {
      reason: CONTENT_MANAGE_OPEN_REASON,
    },
  },
} as const;

export const contentFeature = defineFeature("content", (r) => {
  r.crud("page", pageEntity, {
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
