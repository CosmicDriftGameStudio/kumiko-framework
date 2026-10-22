import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  from,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import type { RowAction } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { ListRowViewModel, Translate } from "../../headless/index.ts";
import { runBulkWrites } from "../../hooks/use-bulk-run.ts";
import { createLiveDispatcher } from "../../live/index.ts";
import { buildListBulkActions } from "../list-bulk-actions.ts";

const ARCHIVE_HANDLER = "bulk-tasks:write:task:delete";

// Everyone reads every task, but only the assignee may archive it: the row of another assignee is the one without access.
const taskEntity = createEntity({
  table: "read_bulk_tasks",
  softDelete: true,
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
    assigneeId: createTextField({ personal: "ref" }),
  },
  access: {
    read: { Admin: "all", Member: "all" },
    write: { Admin: "all", Member: from("user:id", "assigneeId") },
  },
});

const bulkTasksFeature = defineFeature("bulk-tasks", (r) => {
  const taskAccess = { access: { roles: ["Admin", "Member"] } } as const;
  r.crud("task", taskEntity, { write: taskAccess, read: taskAccess });
});

const member = createTestUser({
  id: "33333333-0000-4000-8000-000000000001",
  roles: ["Member"],
});
const otherMemberId = "33333333-0000-4000-8000-000000000002";

const rowActions: readonly RowAction[] = [
  {
    kind: "writeHandler",
    id: "archive",
    label: "Archive",
    handler: ARCHIVE_HANDLER,
    visible: { field: "title", ne: "Pinned" },
  },
];

const keyAsText: Translate = (key) => key;

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [bulkTasksFeature] });
  await unsafeCreateEntityTable(stack.db, taskEntity, "task");
});

afterAll(async () => {
  await stack.cleanup();
});

async function createTask(title: string, assigneeId: string): Promise<ListRowViewModel> {
  const created = await stack.http.writeOk<{ id: string }>(
    "bulk-tasks:write:task:create",
    { title, assigneeId },
    TestUsers.admin,
  );
  return { id: created.id, values: { id: created.id, title, assigneeId } };
}

async function memberDispatcher() {
  const csrfToken = generateToken();
  const cookieHeader = `kumiko_auth=${await stack.jwt.sign(member)}; kumiko_csrf=${csrfToken}`;
  // fetch also carries preconnect, a hint the in-memory app has no use for; the real one keeps the type whole.
  const fetchThroughApp = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      stack.app.request(String(input), {
        ...init,
        headers: { ...init?.headers, Cookie: cookieHeader },
      }),
    { preconnect: fetch.preconnect },
  );
  return createLiveDispatcher({ fetch: fetchThroughApp, readCsrf: () => csrfToken });
}

describe("bulk actions over /api/write", () => {
  test("each row is its own write: the row without access fails, the others archive with one event each", async () => {
    const ownRows = [
      await createTask("Order paper", member.id),
      await createTask("Call the tax office", member.id),
      await createTask("File receipts", member.id),
    ];
    const foreignRow = await createTask("Plan the offsite", otherMemberId);
    const pinnedRow = await createTask("Pinned", member.id);

    const [archive] = buildListBulkActions({
      bulkActions: [{ id: "archive", rowAction: "archive" }],
      rowActions,
      translate: keyAsText,
      dispatcher: await memberDispatcher(),
    });
    if (archive === undefined) throw new Error("archive bulk action did not resolve");

    const result = await runBulkWrites({
      rows: [...ownRows, foreignRow, pinnedRow],
      action: archive,
      isCancelled: () => false,
    });

    expect([...result.succeededIds].sort()).toEqual(ownRows.map((row) => row.id).sort());
    expect(result.failedIds).toEqual([foreignRow.id]);
    expect(result.skippedIds).toEqual([pinnedRow.id]);
    expect(result.firstFailureMessage).toContain("ownership_denied");

    const archiveEvents = (await selectMany(stack.db, eventsTable)).filter(
      (event: Record<string, unknown>) => {
        const metadata = event["metadata"];
        return (
          typeof metadata === "object" &&
          metadata !== null &&
          "handler" in metadata &&
          metadata.handler === ARCHIVE_HANDLER
        );
      },
    );
    expect(archiveEvents.map((event) => String(event["aggregateId"])).sort()).toEqual(
      ownRows.map((row) => row.id).sort(),
    );
  });
});
