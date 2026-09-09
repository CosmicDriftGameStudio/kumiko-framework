// WriteForm Section Sample
// Shows: a projectionDetail screen's `kind: "writeForm"` section — a
// self-persisting form embedded in a record detail page — rendered next to
// an established `entityEdit` form for the same fields. That side-by-side
// placement (see e2e/fixtures/client.tsx) is what makes a layout-parity
// comparison between the two form kinds possible.

import {
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const NOTE_CATEGORIES = ["question", "bug", "idea"] as const;

const BODY_NOT_PERSONAL = {
  personal: false,
  reason: "sample recipe fixture text, no real user content",
} as const;

const noteEntity = createEntity({
  table: "read_sample_writeform_notes",
  fields: {
    title: createTextField({ required: true }),
    body: createTextField(BODY_NOT_PERSONAL),
    category: createSelectField({ options: NOTE_CATEGORIES, default: "question" }),
    priority: createNumberField(),
  },
});

const open = { access: { openToAll: true } } as const;

const commentPayloadSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  category: z.enum(NOTE_CATEGORIES).optional(),
  priority: z.number().optional(),
});

export const noteDeskFeature = defineFeature("note-desk", (r) => {
  r.translations({
    keys: {
      "screen:note-edit.title": { en: "Edit note" },
      "screen:note-detail.title": { en: "Note" },
      "note-desk:entity:note:field:title": { en: "Title" },
      "note-desk:entity:note:field:body": { en: "Body" },
      "note-desk:entity:note:field:category": { en: "Category" },
      "note-desk:entity:note:field:priority": { en: "Priority" },
      "note-desk:entity:__write-form-section__:field:title": { en: "Title" },
      "note-desk:entity:__write-form-section__:field:body": { en: "Body" },
      "note-desk:entity:__write-form-section__:field:category": { en: "Category" },
      "note-desk:entity:__write-form-section__:field:priority": { en: "Priority" },
    },
  });

  r.crud("note", noteEntity, { write: open, read: open });

  r.screen({
    id: "note-edit",
    type: "entityEdit",
    entity: "note",
    layout: {
      sections: [
        {
          title: "Note",
          columns: 2,
          fields: [{ field: "title", span: 2 }, "category", "priority", { field: "body", span: 2 }],
        },
      ],
    },
    access: open.access,
  });

  r.queryHandler(
    "note:detail",
    z.object({ id: z.string() }),
    async (query) => ({
      id: query.payload.id,
      title: "Sample note",
      category: "question",
      priority: 2,
      body: "...",
    }),
    open,
  );

  r.writeHandler(
    "note:comment",
    commentPayloadSchema,
    async () => ({ isSuccess: true as const, data: null }),
    open,
  );

  r.screen({
    id: "note-detail",
    type: "projectionDetail",
    query: "note-desk:query:note:detail",
    layout: {
      sections: [
        {
          // Same field set as note-edit's section — that's what makes the
          // two forms comparable in the e2e layout-parity spec.
          kind: "writeForm",
          title: "Add comment",
          columns: 2,
          fieldDefs: {
            title: createTextField({ required: true }),
            body: createTextField(BODY_NOT_PERSONAL),
            category: createSelectField({ options: NOTE_CATEGORIES, default: "question" }),
            priority: createNumberField(),
          },
          fields: [{ field: "title", span: 2 }, "category", "priority", { field: "body", span: 2 }],
          handler: "note-desk:write:note:comment",
        },
      ],
    },
    access: open.access,
  });
});
