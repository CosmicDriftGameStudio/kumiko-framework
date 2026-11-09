import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { MAX_BULK_SELECTION } from "@cosmicdrift/kumiko-framework/ui-types";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createTaskBoardFeature } from "../feature";

type ListAggregateResult = {
  readonly groups: readonly { key: unknown; count: number; measures: readonly unknown[] }[];
};

let stack: TestStack;
const user = createTestUser({ roles: ["User"], tenantId: testTenantId(1) });

const TASKS = [
  { title: "Quarterly VAT filing", assignee: "Ines", estimateHours: 6 },
  { title: "Prepare audit", assignee: "Ines", estimateHours: 24 },
  { title: "Plan offsite", assignee: "Mara", estimateHours: 7 },
] as const;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTaskBoardFeature()], systemHooks: [] });
  for (const task of TASKS) {
    await stack.http.writeOk("task-board:write:task:create", task, user);
  }
});

afterAll(async () => {
  await stack.cleanup();
});

describe("hand-written list query with aggregate", () => {
  test("groups by assignee with the server count and estimate sum", async () => {
    const result = await stack.http.queryOk<ListAggregateResult>(
      "task-board:query:task:workload",
      { aggregate: { groupBy: "assignee", measures: [{ field: "estimateHours", kind: "sum" }] } },
      user,
    );
    expect(result.groups.map(({ key, count, measures }) => ({ key, count, measures }))).toEqual([
      { key: "Ines", count: 2, measures: [30] },
      { key: "Mara", count: 1, measures: [7] },
    ]);
  });

  test("the totals answer follows the list filter", async () => {
    const result = await stack.http.queryOk<ListAggregateResult>(
      "task-board:query:task:workload",
      {
        filters: [{ field: "estimateHours", op: "lte", value: 7 }],
        aggregate: { measures: [{ field: "estimateHours", kind: "sum" }] },
      },
      user,
    );
    expect(result.groups.map((group) => group.measures)).toEqual([[13]]);
  });

  test("without aggregate the same query lists rows", async () => {
    const list = await stack.http.queryOk<{ rows: { title: string }[] }>(
      "task-board:query:task:workload",
      { sort: "title" },
      user,
    );
    expect(list.rows.map((row) => row.title)).toEqual([
      "Plan offsite",
      "Prepare audit",
      "Quarterly VAT filing",
    ]);
  });
});

describe("form bulk action handler", () => {
  test("one write sets the status of every selected task", async () => {
    const created = await Promise.all(
      ["Bulk A", "Bulk B"].map((title) =>
        stack.http.writeOk<{ data: { id: string } }>(
          "task-board:write:task:create",
          { title },
          user,
        ),
      ),
    );
    const taskIds = created.map((task) => task.data.id);
    await stack.http.writeOk(
      "task-board:write:task:set-status",
      { taskIds, status: "blocked", note: "waiting" },
      user,
    );
    const list = await stack.http.queryOk<{
      rows: { title: string; status: string; note: string }[];
    }>("task-board:query:task:list", { sort: "title" }, user);
    expect(
      list.rows.filter((row) => row.title.startsWith("Bulk")).map((row) => [row.status, row.note]),
    ).toEqual([
      ["blocked", "waiting"],
      ["blocked", "waiting"],
    ]);
  });

  test("the preview query shows the same plan the handler applies", async () => {
    const created = await Promise.all(
      ["Plan A", "Plan B"].map((title) =>
        stack.http.writeOk<{ data: { id: string } }>(
          "task-board:write:task:create",
          { title, status: title === "Plan B" ? "blocked" : "open" },
          user,
        ),
      ),
    );
    const taskIds = created.map((task) => task.data.id);
    const preview = await stack.http.queryOk<{
      count: number;
      tasks: { title: string; before: string; after: string }[];
    }>("task-board:query:task:set-status-preview", { taskIds, status: "blocked" }, user);
    expect(preview).toEqual({
      count: 1,
      tasks: [
        { title: "Plan A", before: "open", after: "blocked" },
        { title: "Plan B", before: "blocked", after: "blocked" },
      ],
    });
  });

  test("an unknown id fails the whole write and a list above the cap is rejected", async () => {
    const unknown = await stack.http.write(
      "task-board:write:task:set-status",
      { taskIds: ["11111111-1111-4111-8111-111111111111"], status: "done" },
      user,
    );
    const unknownBody = (await unknown.json()) as { isSuccess: boolean; error?: { code: string } };
    expect(unknownBody.isSuccess).toBe(false);
    expect(unknownBody.error?.code).toBe("not_found");

    const tooMany = await stack.http.write(
      "task-board:write:task:set-status",
      {
        taskIds: Array.from({ length: MAX_BULK_SELECTION + 1 }, () => crypto.randomUUID()),
        status: "done",
      },
      user,
    );
    const tooManyBody = (await tooMany.json()) as { isSuccess: boolean; error?: { code: string } };
    expect(tooManyBody.isSuccess).toBe(false);
    expect(tooManyBody.error?.code).toBe("validation_error");
  });
});
