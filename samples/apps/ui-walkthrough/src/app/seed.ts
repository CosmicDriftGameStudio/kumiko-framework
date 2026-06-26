// Seed for ui-walkthrough — a handful of tasks so the generated list screen
// isn't empty in `bun dev` and the screenshot runner renders real rows. Goes
// through the normal dispatcher (tasks:write:task:create) so validation +
// audit + search-index run like a real request. Idempotent: skips when the
// tenant already has tasks (persistent KUMIKO_DEV_DB_NAME survives reboots).

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";

const DEMO_TASKS = [
  { title: "Ship the docs overhaul", status: "in progress", priority: 1, isUrgent: true },
  { title: "Review the tutorial PR", status: "todo", priority: 2, isUrgent: false },
  { title: "Regenerate the screenshots", status: "todo", priority: 3, isUrgent: false },
  { title: "Reply on the launch thread", status: "done", priority: 2, isUrgent: false },
  { title: "Plan the next sprint", status: "todo", priority: 5, isUrgent: false },
] as const;

export const seedTasks: SeedFn = async (stack) => {
  const tenantId = TestUsers.admin.tenantId;
  const rows = await asRawClient(stack.db).unsafe<{ count: number }>(
    `SELECT count(*)::int AS count FROM read_ui_walkthrough_tasks WHERE tenant_id = $1`,
    [tenantId],
  );
  if ((rows[0]?.count ?? 0) > 0) return;
  for (const task of DEMO_TASKS) {
    await stack.http.write("tasks:write:task:create", task, TestUsers.admin);
  }
};
