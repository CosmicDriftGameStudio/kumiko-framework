import {
  answerListAggregate,
  buildEntityTable,
  createEventStoreExecutor,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createDateField,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
  entityListSchema,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ListTableOptions } from "@cosmicdrift/kumiko-framework/ui-types";
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
  },
});

export const openAccess = {
  access: {
    openToAll: { reason: "recipe: any signed-in user manages the tasks; no per-user ownership" },
  },
} as const;

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
        "priority",
        { field: "dueDate", hideOnNarrow: true },
        { field: "assignee", hideOnNarrow: true },
        // Starts hidden; the user can add it back in the view menu.
        { field: "estimateHours", hidden: true, hideOnNarrow: true },
      ],
      facets: { status: { display: "chips" }, priority: {}, estimateHours: { display: "range" } },
      defaultSort: { field: "dueDate", dir: "asc" },
      searchable: true,
      table: taskTable,
      rowActions: [
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
      // Row checkboxes and a selection bar; each selected row gets its own delete write.
      bulkActions: [{ id: "delete", rowAction: "delete" }],
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
