import {
  answerListAggregate,
  buildEntityTable,
  createEventStoreExecutor,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
  defineFeature,
  entityListSchema,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { type ListTableOptions, MAX_BULK_SELECTION } from "@cosmicdrift/kumiko-framework/ui-types";
import { z } from "zod";

export const taskEntity = createEntity({
  table: "read_list_table_tasks",
  fields: {
    title: createTextField({
      personal: false,
      reason: "is_business_data",
      required: true,
      searchable: true,
      sortable: true,
    }),
    status: createSelectField({
      options: ["open", "inProgress", "blocked", "done"] as const,
      default: "open",
      sortable: true,
      filterable: true,
    }),
    priority: createSelectField({
      options: ["low", "medium", "high"] as const,
      default: "medium",
      sortable: true,
      filterable: true,
    }),
    dueDate: createDateField({ sortable: true }),
    assignee: createTextField({ personal: false, reason: "is_business_data", sortable: true }),
    estimateHours: createNumberField({ sortable: true, filterable: true }),
    parked: createBooleanField({ default: false }),
    note: createTextField({ personal: false, reason: "is_business_data" }),
    team: createTextField({ personal: false, reason: "is_business_data" }),
    teamTone: createSelectField({
      options: ["positive", "warn", "negative", "neutral"] as const,
      default: "neutral",
    }),
    lastUpdate: createTimestampField({ sortable: true }),
  },
});

export const openAccess = {
  access: {
    openToAll: { reason: "recipe: any signed-in user manages the tasks; no per-user ownership" },
  },
} as const;

const setStatusInput = z.object({
  taskIds: z.array(z.uuid()).min(1).max(MAX_BULK_SELECTION),
  status: z.enum(taskEntity.fields.status.options),
});

type StatusPlanRow = {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly before: string;
  readonly after: string;
};

// The one rule behind the status form: the write handler applies it and the preview query shows it.
async function planStatusChanges(
  taskIds: readonly string[],
  status: string,
  loadTask: (id: string) => Promise<Readonly<Record<string, unknown>> | null | undefined>,
): Promise<{ readonly rows: readonly StatusPlanRow[] } | { readonly missingId: string }> {
  const rows: StatusPlanRow[] = [];
  for (const id of taskIds) {
    const task = await loadTask(id);
    if (!task) return { missingId: id };
    rows.push({
      id,
      version: Number(task["version"]),
      title: String(task["title"]),
      before: String(task["status"]),
      after: status,
    });
  }
  return { rows };
}
// Overridable so a test can feed the boot validator a block that must be rejected.
export function createTaskBoardFeature(
  taskTable: ListTableOptions = {
    rememberState: true,
    resetAll: true,
    columnPicker: true,
    density: { default: "comfortable", userChoice: true },
    pinning: true,
    resizing: true,
    keyboardNavigation: true,
    export: { xlsx: true, maxRows: 5000 },
    grouping: { field: "status", collapsedWhen: "done", userChoice: true, fields: ["priority"] },
    totals: [{ field: "estimateHours", kind: "sum" }],
  },
): FeatureDefinition {
  return defineFeature("task-board", (r) => {
    r.crud("task", taskEntity, { write: openAccess, read: openAccess });

    r.screen({
      id: "task-list",
      type: "entityList",
      entity: "task",
      columns: [
        // Starts pinned left; width and minWidth are start values for resizing.
        { field: "title", pinned: "left", width: 280, minWidth: 160 },
        "status",
        // The phone card shows the priority as its outlined pill instead of the first select column.
        { field: "priority", cardBadge: true },
        { field: "dueDate", hideOnNarrow: true },
        // The team pill sits beside the assignee name; its tone comes from the row.
        {
          field: "assignee",
          hideOnNarrow: true,
          pillField: "team",
          pillToneField: "teamTone",
          emptyPlaceholder: "Unassigned",
        },
        // One truncated line in the table; a line break starts a new line on the phone card.
        {
          field: "note",
          ellipsis: true,
          multiline: true,
          tone: "muted",
          cardAbove: true,
          hideWhenDocked: true,
          emptyPlaceholder: false,
        },
        // Recent edits show date and time, older ones the date only.
        { field: "lastUpdate", dateOnlyAfterDays: 7, hideOnNarrow: true },
        // Starts hidden; the user can add it back in the view menu.
        { field: "estimateHours", hidden: true, hideOnNarrow: true },
      ],
      facets: { status: { display: "chips" }, priority: {}, estimateHours: { display: "range" } },
      defaultSort: { field: "dueDate", dir: "asc" },
      searchable: true,
      table: taskTable,
      mutedRowField: "parked",
      toolbarSort: true,
      sortOptions: [
        { field: "dueDate", dir: "asc", label: "Due date" },
        { field: "priority", dir: "desc", label: "Priority" },
      ],
      rowActions: [
        // A closed state as muted text instead of a button.
        {
          kind: "navigate",
          id: "closed",
          label: "Closed",
          screen: "task-edit",
          display: "text",
          visible: { field: "status", eq: "done" },
        },
        { kind: "navigate", id: "open", label: "Open", screen: "task-edit", rowClick: true },
        {
          kind: "writeHandler",
          id: "delete",
          label: "Delete",
          handler: "task-board:write:task:delete",
          style: "danger",
          // Done tasks are skipped by the bulk run and counted as skipped.
          visible: { field: "status", ne: "done" },
        },
      ],
      // Row checkboxes and a selection bar; delete writes once per row, set-status once for all.
      bulkActions: [
        { id: "delete", rowAction: "delete" },
        {
          id: "set-status",
          label: "Set status",
          icon: "edit",
          screen: "task-set-status",
          idsField: "taskIds",
        },
      ],
      access: openAccess.access,
    });

    r.screen({
      id: "task-edit",
      type: "entityEdit",
      entity: "task",
      dormant: true,
      listScreenId: "task-list",
      layout: {
        sections: [
          {
            columns: 2,
            fields: ["title", "assignee", "status", "priority", "dueDate", "estimateHours"],
          },
        ],
      },
    });

    // The same block works on a list over any query.
    r.queryHandler({
      name: "task:overdue",
      schema: z.object({}),
      handler: async () => ({
        rows: [{ id: "t1", title: "Quarterly VAT filing", assignee: "Ines", daysLate: 3 }],
        nextCursor: null,
      }),
      access: openAccess.access,
      outputSchema: z.object({
        rows: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            assignee: z.string(),
            daysLate: z.number(),
          }),
        ),
        nextCursor: z.string().nullable(),
      }),
    });

    r.screen({
      id: "task-overdue",
      type: "projectionList",
      query: "task-board:query:task:overdue",
      columns: ["title", "assignee", "daysLate"],
      table: { rememberState: true, density: { userChoice: true } },
    });

    // A hand-written list query keeps grouping and totals when it accepts
    // `aggregate` (entityListSchema carries it) and answers it on the server.
    const taskExecutor = createEventStoreExecutor(
      buildEntityTable("task", taskEntity),
      taskEntity,
      {
        entityName: "task",
      },
    );
    r.queryHandler({
      name: "task:workload",
      schema: entityListSchema,
      handler: async (query, ctx) => {
        const parentVisibility = { entities: ctx.registry.getAllEntities() };
        const listPayload = query.payload;
        if (listPayload.aggregate !== undefined) {
          return answerListAggregate(
            taskExecutor,
            { ...listPayload, aggregate: listPayload.aggregate },
            query.user,
            ctx.db,
            { parentVisibility },
            {
              entity: taskEntity,
              resolveEntity: (name) => ctx.registry.getEntity(name),
              viewer: { user: query.user, parentVisibility },
            },
          );
        }
        return taskExecutor.list(listPayload, query.user, ctx.db, { parentVisibility });
      },
      access: openAccess.access,
    });

    r.screen({
      id: "task-workload",
      type: "projectionList",
      query: "task-board:query:task:workload",
      columns: ["title", "assignee", "status", "estimateHours"],
      defaultSort: { field: "title", dir: "asc" },
      table: {
        grouping: { field: "assignee" },
        totals: [{ field: "estimateHours", kind: "sum" }],
      },
    });

    // One write for the whole selection: the bulk action below opens this form and `taskIds`
    // arrives as a string array. The client cap is no protection, so the schema bounds the list
    // and every id is read through the tenant-scoped executor before anything is written.
    r.writeHandler({
      name: "task:set-status",
      schema: setStatusInput.extend({ note: z.string().optional() }),
      access: openAccess.access,
      handler: async (event, ctx) => {
        const { taskIds, status, note } = event.payload;
        const plan = await planStatusChanges(taskIds, status, (id) =>
          taskExecutor.detail({ id }, event.user, ctx.db),
        );
        if ("missingId" in plan) return failNotFound("task", plan.missingId);
        const changed = plan.rows.filter((row) => row.before !== row.after);
        for (const row of changed) {
          const result = await taskExecutor.update(
            { id: row.id, version: row.version, changes: { status, note } },
            event.user,
            ctx.db,
          );
          if (!result.isSuccess) return result;
        }
        return { isSuccess: true as const, data: { count: changed.length } };
      },
    });

    // The preview runs the same plan the write handler runs, so the two cannot drift apart.
    r.queryHandler({
      name: "task:set-status-preview",
      schema: setStatusInput,
      access: openAccess.access,
      handler: async (query, ctx) => {
        const { taskIds, status } = query.payload;
        const plan = await planStatusChanges(taskIds, status, (id) =>
          taskExecutor.detail({ id }, query.user, ctx.db),
        );
        if ("missingId" in plan) throw new NotFoundError("task");
        return {
          count: plan.rows.filter((row) => row.before !== row.after).length,
          tasks: plan.rows.map(({ title, before, after }) => ({ title, before, after })),
        };
      },
    });

    r.screen({
      id: "task-set-status",
      type: "actionForm",
      dormant: true,
      handler: "task-board:write:task:set-status",
      listScreenId: "task-list",
      redirect: "task-list",
      fields: {
        taskIds: { type: "multiSelect", options: [], display: "count" },
        status: createSelectField({
          options: ["open", "inProgress", "blocked", "done"] as const,
          required: true,
        }),
        note: createTextField({ personal: false, reason: "is_business_data" }),
      },
      layout: { sections: [{ fields: ["taskIds", "status", "note"] }] },
      // Which tasks change and from what to what, shown before the user submits.
      preview: {
        query: "task-board:query:task:set-status-preview",
        fields: ["taskIds", "status"],
        title: "Preview",
        facts: [{ field: "count", label: "Tasks that change" }],
        list: {
          field: "tasks",
          columns: [
            { field: "title", label: "Task" },
            { field: "before", label: "Now" },
            { field: "after", label: "New" },
          ],
        },
      },
    });

    r.nav({ id: "tasks", label: "task-board:nav.tasks", icon: "list", order: 10 });
    r.nav({
      id: "task-list",
      label: "task-board:nav.list",
      parent: "task-board:nav:tasks",
      screen: "task-board:screen:task-list",
      order: 10,
    });
    r.nav({
      id: "task-overdue",
      label: "task-board:nav.overdue",
      parent: "task-board:nav:tasks",
      screen: "task-board:screen:task-overdue",
      order: 20,
    });
    r.nav({
      id: "task-workload",
      label: "task-board:nav.workload",
      parent: "task-board:nav:tasks",
      screen: "task-board:screen:task-workload",
      order: 30,
    });
  });
}
