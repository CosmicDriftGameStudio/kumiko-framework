import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";

type SeedTask = {
  readonly title: string;
  readonly status: "open" | "inProgress" | "blocked" | "done";
  readonly priority: "low" | "medium" | "high";
  readonly dueDate: string;
  readonly assignee: string;
  readonly estimateHours: number;
};

const TASKS: readonly SeedTask[] = [
  {
    title: "Quarterly VAT filing",
    status: "inProgress",
    priority: "high",
    dueDate: "2026-11-10",
    assignee: "Ines Vogel",
    estimateHours: 6,
  },
  {
    title: "Renew office lease",
    status: "open",
    priority: "medium",
    dueDate: "2026-12-01",
    assignee: "Tomas Berg",
    estimateHours: 3,
  },
  {
    title: "Onboard new support hire",
    status: "open",
    priority: "high",
    dueDate: "2026-11-03",
    assignee: "Ines Vogel",
    estimateHours: 12,
  },
  {
    title: "Migrate invoices to new numbering",
    status: "blocked",
    priority: "high",
    dueDate: "2026-11-15",
    assignee: "Mara Lindqvist",
    estimateHours: 16,
  },
  {
    title: "Update privacy policy",
    status: "done",
    priority: "medium",
    dueDate: "2026-10-20",
    assignee: "Tomas Berg",
    estimateHours: 4,
  },
  {
    title: "Order replacement laptops",
    status: "inProgress",
    priority: "low",
    dueDate: "2026-11-25",
    assignee: "Mara Lindqvist",
    estimateHours: 2,
  },
  {
    title: "Prepare annual audit documents",
    status: "open",
    priority: "high",
    dueDate: "2027-01-15",
    assignee: "Ines Vogel",
    estimateHours: 24,
  },
  {
    title: "Fix mobile checkout layout",
    status: "inProgress",
    priority: "medium",
    dueDate: "2026-11-05",
    assignee: "Jonas Keller",
    estimateHours: 8,
  },
  {
    title: "Review supplier contracts",
    status: "blocked",
    priority: "medium",
    dueDate: "2026-11-30",
    assignee: "Tomas Berg",
    estimateHours: 10,
  },
  {
    title: "Archive 2025 customer files",
    status: "done",
    priority: "low",
    dueDate: "2026-10-31",
    assignee: "Jonas Keller",
    estimateHours: 5,
  },
  {
    title: "Plan team offsite",
    status: "open",
    priority: "low",
    dueDate: "2027-02-20",
    assignee: "Mara Lindqvist",
    estimateHours: 7,
  },
  {
    title: "Set up weekly sales report",
    status: "inProgress",
    priority: "medium",
    dueDate: "2026-11-12",
    assignee: "Jonas Keller",
    estimateHours: 9,
  },
];

export const seedWorkboardTasks: SeedFn = async (stack) => {
  for (const task of TASKS) {
    const res = await stack.http.write("workboard:write:task:create", task, TestUsers.admin);
    if (!res.ok) {
      // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
      console.error(`[seed] workboard task "${task.title}" failed:`, await res.text());
      return;
    }
  }
};
