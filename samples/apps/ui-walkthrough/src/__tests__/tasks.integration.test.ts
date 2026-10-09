import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { seedTenant, setupAppTestStack } from "@cosmicdrift/kumiko-testing";
import { taskFeature } from "../features/tasks";

const TASK_CREATE = "tasks:write:task:create";
const TASK_LIST = "tasks:query:task:list";

type TaskList = { rows: { title: string }[] };

let stack: TestStack;

beforeAll(async () => {
  stack = await setupAppTestStack([taskFeature]);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tasks", () => {
  test("a created task is listed for its own tenant only", async () => {
    const owner = await seedTenant(stack);
    const other = await seedTenant(stack);

    await owner.api.writeOk(TASK_CREATE, { title: "Write tests", status: "todo", priority: 1 });

    const ownerTasks = await owner.api.queryOk<TaskList>(TASK_LIST, {});
    expect(ownerTasks.rows.map((row) => row.title)).toEqual(["Write tests"]);
    const otherTasks = await other.api.queryOk<TaskList>(TASK_LIST, {});
    expect(otherTasks.rows).toEqual([]);
  });
});
