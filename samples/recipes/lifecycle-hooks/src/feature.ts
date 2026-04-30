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
} from "@kumiko/framework/engine";
import { ConflictError } from "@kumiko/framework/errors";

export const articleEntity = createEntity({
  table: "read_sample_articles",
  fields: {
    // maxLength high so zod lets long titles through — the validation hook
    // below rejects titles > 200 so the sample can demonstrate the hook path.
    title: createTextField({ required: true, maxLength: 1000 }),
    content: createTextField(),
    status: createTextField({ default: "draft" }),
    isPublished: createBooleanField({ default: false }),
  },
});

// Collect hook events for testing
export const hookLog: { type: string; data: Record<string, unknown> }[] = [];

const editorWrite = { access: { roles: ["Admin", "Editor"] } } as const;

export const articlesFeature = defineFeature("blog", (r) => {
  const article = r.entity("article", articleEntity);

  const articleCreate = r.writeHandler(
    defineEntityCreateHandler("article", articleEntity, editorWrite),
  );
  const articleUpdate = r.writeHandler(
    defineEntityUpdateHandler("article", articleEntity, editorWrite),
  );
  r.writeHandler(defineEntityDeleteHandler("article", articleEntity, editorWrite));

  // --- Validation hook on create: reject banned words + length ---
  r.hook("validation", articleCreate, (data) => {
    const title = data["title"] as string;
    if (title.toLowerCase().includes("spam")) {
      return [{ field: "title", error: "title_contains_banned_word" }];
    }
    if (title.length > 200) {
      return [{ field: "title", error: "title_too_long" }];
    }
    return null;
  });

  // --- Validation hook on update: length check on title changes ---
  r.hook("validation", articleUpdate, (data) => {
    const changes = data["changes"] as Record<string, unknown> | undefined;
    const title = changes?.["title"] as string | undefined;
    if (title && title.length > 200) {
      return [{ field: "title", error: "title_too_long" }];
    }
    return null;
  });

  // --- postSave entity hook: log all saves ---
  r.entityHook("postSave", article, async (result: SaveContext) => {
    hookLog.push({
      type: result.isNew ? "created" : "updated",
      data: { id: result.id, changes: result.changes },
    });
  });

  // --- preDelete entity hook: block delete when the article is still published.
  // preDelete runs inside the write transaction and throws on violation, so
  // the delete rolls back before any projection or event is written. The
  // payload.data carries the full row snapshot taken just before delete —
  // no extra load needed.
  r.entityHook("preDelete", article, async (payload) => {
    if (payload.data["isPublished"] === true) {
      throw new ConflictError({
        message: `article ${payload.id} is still published`,
        i18nKey: "errors.publishedArticleCannotBeDeleted",
        details: { reason: "published_article_cannot_be_deleted", entityId: payload.id },
      });
    }
  });

  // --- postDelete entity hook: log deletions after the transaction commits.
  // Default phase is afterCommit so failures here can't roll back the delete.
  r.entityHook("postDelete", article, async (payload) => {
    hookLog.push({
      type: "deleted",
      data: { id: payload.id },
    });
  });
});
