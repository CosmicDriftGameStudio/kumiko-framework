import { defineFeature } from "@cosmicdrift/kumiko-framework";

export const notesFeature = defineFeature("notes", (r) => {
  r.entity("note", {
    fields: {
      title: r.text().required(),
      body: r.text(),
    },
  });
});
