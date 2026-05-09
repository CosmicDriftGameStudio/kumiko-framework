// Lifecycle Hooks Sample — Integration Test
// Proves: validation rejects bad data, postSave tracks changes

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { articleEntity, articlesFeature, hookLog } from "../feature";

let stack: TestStack;

const editor = createTestUser({ roles: ["Admin", "Editor"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [articlesFeature] });
  await unsafeCreateEntityTable(stack.db, articleEntity);
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  stack.events.reset();
  hookLog.length = 0;
});

describe("validation hook: single handler", () => {
  test("rejects title with banned word", async () => {
    const error = await stack.http.writeErr(
      "blog:write:article:create",
      {
        title: "Buy cheap SPAM now",
      },
      editor,
    );

    expectErrorIncludes(error, "title_contains_banned_word");
  });

  test("accepts clean title", async () => {
    const data = await stack.http.writeOk(
      "blog:write:article:create",
      {
        title: "Clean Article",
      },
      editor,
    );

    expect(data.isNew).toBe(true);
  });
});

describe("validation hook: multi-handler", () => {
  test("rejects overly long title on create", async () => {
    const error = await stack.http.writeErr(
      "blog:write:article:create",
      {
        title: "X".repeat(201),
      },
      editor,
    );

    expectErrorIncludes(error, "title_too_long");
  });

  test("rejects overly long title on update", async () => {
    const created = await stack.http.writeOk(
      "blog:write:article:create",
      {
        title: "Short",
      },
      editor,
    );

    const error = await stack.http.writeErr(
      "blog:write:article:update",
      {
        id: created.id,
        changes: { title: "Y".repeat(201) },
        version: 1,
      },
      editor,
    );

    expectErrorIncludes(error, "title_too_long");
  });
});

describe("postSave entity hook", () => {
  test("logs create event", async () => {
    await stack.http.writeOk(
      "blog:write:article:create",
      {
        title: "Hook Test",
      },
      editor,
    );

    expect(hookLog).toHaveLength(1);
    expect(hookLog[0]?.type).toBe("created");
  });

  test("logs update event with changes", async () => {
    const created = await stack.http.writeOk(
      "blog:write:article:create",
      {
        title: "Before Update",
      },
      editor,
    );

    hookLog.length = 0;

    await stack.http.writeOk(
      "blog:write:article:update",
      {
        id: created.id,
        changes: { title: "After Update" },
        version: 1,
      },
      editor,
    );

    expect(hookLog).toHaveLength(1);
    expect(hookLog[0]?.type).toBe("updated");
    expect(hookLog[0]?.data.changes).toEqual({ title: "After Update" });
  });
});

describe("preDelete + postDelete entity hooks", () => {
  test("postDelete fires after a successful delete", async () => {
    const created = await stack.http.writeOk(
      "blog:write:article:create",
      { title: "Doomed" },
      editor,
    );

    hookLog.length = 0;

    await stack.http.writeOk("blog:write:article:delete", { id: created.id }, editor);

    expect(hookLog).toHaveLength(1);
    expect(hookLog[0]?.type).toBe("deleted");
    expect(hookLog[0]?.data.id).toBe(created.id);
  });

  test("preDelete blocks delete when the article is still published", async () => {
    const created = await stack.http.writeOk(
      "blog:write:article:create",
      { title: "Live Article" },
      editor,
    );
    await stack.http.writeOk(
      "blog:write:article:update",
      {
        id: created.id,
        changes: { isPublished: true },
        version: 1,
      },
      editor,
    );

    hookLog.length = 0;

    const error = await stack.http.writeErr(
      "blog:write:article:delete",
      { id: created.id },
      editor,
    );

    expectErrorIncludes(error, "published_article_cannot_be_deleted");

    // postDelete MUST NOT fire when preDelete rolled the tx back
    expect(hookLog.filter((e) => e.type === "deleted")).toHaveLength(0);
  });

  test("preDelete allows delete when article is not published", async () => {
    const created = await stack.http.writeOk(
      "blog:write:article:create",
      { title: "Draft Article" },
      editor,
    );

    hookLog.length = 0;

    await stack.http.writeOk("blog:write:article:delete", { id: created.id }, editor);

    expect(hookLog.map((e) => e.type)).toEqual(["deleted"]);
  });
});
