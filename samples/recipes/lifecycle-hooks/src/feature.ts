// Lifecycle Hooks Sample
// Shows: validation hooks (reject bad data), postSave entity hooks (track changes),
// preDelete hooks (block delete on invariant violation), postDelete hooks
// (log deletions after commit).

import {
  createBooleanField,
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type SaveContext,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";

export const articleEntity = createEntity({
  table: "read_sample_articles",
  fields: {
    // maxLength high so zod lets long titles through — the validation hook
    // below rejects titles > 200 so the sample can demonstrate the hook path.
    title: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      maxLength: 1000,
    }),
    content: createTextField({ personal: false, reason: "is_business_data" }),
    status: createTextField({ personal: false, reason: "is_business_data", default: "draft" }),
    isPublished: createBooleanField({ default: false }),
  },
});

// Collect hook events for testing
export const hookLog: { type: string; data: Record<string, unknown> }[] = [];

// Stands in for a quota held in an external system, outside the handler transaction.
export const reservedSlots = new Set<string>();

const editorWrite = { access: { roles: ["Admin", "Editor"] } } as const;

export const articlesFeature = defineFeature("blog", (r) => {
  const article = r.entity({ name: "article", ...articleEntity });

  const articleCreate = r.writeHandler(
    defineEntityCreateHandler("article", articleEntity, editorWrite),
  );
  const articleUpdate = r.writeHandler(
    defineEntityUpdateHandler("article", articleEntity, editorWrite),
  );
  r.writeHandler(defineEntityDeleteHandler("article", articleEntity, editorWrite));

  // --- scheduleAfterRollback: give back a reservation made outside the transaction when it does
  // not commit. The callback must be idempotent: a failed COMMIT also triggers it.
  r.writeHandler({
    name: "article:reserve-slot",
    schema: z.object({ slot: z.string(), reject: z.boolean() }),
    access: editorWrite.access,
    handler: async (event, ctx) => {
      const { slot, reject } = event.payload;
      reservedSlots.add(slot);
      ctx.lifecycle.afterRollback?.(async () => {
        reservedSlots.delete(slot);
      });
      if (reject) return writeFailure(new UnprocessableError("slot_rejected"));
      return { isSuccess: true as const, data: {} };
    },
  });

  // --- Validation hook on create: reject banned words + length ---
  r.hook({
    type: "validation",
    target: articleCreate,
    handler: (data) => {
      const title = data["title"] as string;
      if (title.toLowerCase().includes("spam")) {
        return [{ field: "title", error: "title_contains_banned_word" }];
      }
      if (title.length > 200) {
        return [{ field: "title", error: "title_too_long" }];
      }
      return null;
    },
  });

  // --- Validation hook on update: length check on title changes ---
  r.hook({
    type: "validation",
    target: articleUpdate,
    handler: (data) => {
      const changes = data["changes"] as Record<string, unknown> | undefined;
      const title = changes?.["title"] as string | undefined;
      if (title && title.length > 200) {
        return [{ field: "title", error: "title_too_long" }];
      }
      return null;
    },
  });

  // --- postSave entity hook: log all saves ---
  r.hook({
    type: "postSave",
    target: { allOf: article },
    handler: async (result: SaveContext) => {
      hookLog.push({
        type: result.isNew ? "created" : "updated",
        data: { id: result.id, changes: result.changes },
      });
    },
  });

  // --- preDelete entity hook: block delete when the article is still published.
  // preDelete runs inside the write transaction and throws on violation, so
  // the delete rolls back before any projection or event is written. The
  // payload.data carries the full row snapshot taken just before delete —
  // no extra load needed.
  r.hook({
    type: "preDelete",
    target: { allOf: article },
    handler: async (payload) => {
      if (payload.data["isPublished"] === true) {
        throw new ConflictError({
          message: `article ${payload.id} is still published`,
          i18nKey: "errors.publishedArticleCannotBeDeleted",
          details: { reason: "published_article_cannot_be_deleted", entityId: payload.id },
        });
      }
    },
  });

  // --- postDelete entity hook: log deletions after the transaction commits.
  // Default phase is afterCommit so failures here can't roll back the delete.
  r.hook({
    type: "postDelete",
    target: { allOf: article },
    handler: async (payload) => {
      hookLog.push({
        type: "deleted",
        data: { id: payload.id },
      });
    },
  });
});
