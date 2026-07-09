// Demo seed — a few tasks so `bun dev` shows a non-empty list.
// Idempotent: skips when the tenant already has tasks (persistent dev DB).

import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";

const DEMO_TASKS = [
  { title: "Welcome to Kumiko", status: "todo", priority: 1, isUrgent: false },
  { title: "Try editing me", status: "in progress", priority: 2, isUrgent: true },
] as const;

export const seedDemoTasks: SeedFn = async (stack) => {
  const admin = TestUsers.admin;
  const existing = await stack.http.queryOk<{ rows: unknown[] }>(
    "tasks:query:task:list",
    {},
    admin,
  );
  if (existing.rows.length > 0) return;
  for (const task of DEMO_TASKS) {
    await stack.http.write("tasks:write:task:create", task, admin);
  }
};
