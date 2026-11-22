import {
  createSelectField,
  createTextField,
  type ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ListTableOptions } from "@cosmicdrift/kumiko-framework/ui-types";
import { openAccess } from "./access";

export function createTaskListScreen(taskTable: ListTableOptions): ScreenDefinition {
  return {
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
      { field: "plannedMonth", hidden: true, hideOnNarrow: true },
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
        icon: "pencil",
        screen: "task-set-status",
        idsField: "taskIds",
      },
    ],
    access: openAccess.access,
  };
}

export const taskEditScreen: ScreenDefinition = {
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
};

export const taskOverdueScreen: ScreenDefinition = {
  id: "task-overdue",
  type: "projectionList",
  query: "task-board:query:task:overdue",
  columns: ["title", "assignee", "daysLate"],
  table: { rememberState: true, density: { userChoice: true } },
};

// A hand-written query column has no field metadata, so optionsOf points it at the
// select field for its labels.
export const taskWorkloadScreen: ScreenDefinition = {
  id: "task-workload",
  type: "projectionList",
  query: "task-board:query:task:workload",
  columns: [
    "title",
    "assignee",
    { field: "status", renderer: { format: "enumOption", optionsOf: "task-board:task.status" } },
    "estimateHours",
  ],
  defaultSort: { field: "title", dir: "asc" },
  table: {
    grouping: { field: "assignee" },
    totals: [{ field: "estimateHours", kind: "sum" }],
  },
};

export const taskSetStatusScreen: ScreenDefinition = {
  id: "task-set-status",
  type: "actionForm",
  dormant: true,
  handler: "task-board:write:task:set-status",
  listScreenId: "task-list",
  redirect: "task-list",
  labelEntity: "task",
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
        // Phone card: the estimate is the card's key figure (bold, rule above) and drops out at 0 h;
        // the table keeps every value so its columns stay aligned.
        {
          field: "estimateHours",
          label: "Estimate (h)",
          type: "number",
          emphasize: true,
          hideZeroOnCard: true,
        },
        // A FileRef id (null here) is shown with file name and download link.
        { field: "attachmentId", label: "Attachment", type: "file" },
      ],
    },
  },
};

// A plain link such as `?status=done` fills `status` (and only `status`); the success box names
// the applied status by an i18n key the handler returns, shown translated.
export const taskStatusLinkScreen: ScreenDefinition = {
  id: "task-status-link",
  type: "actionForm",
  dormant: true,
  handler: "task-board:write:task:set-status",
  labelEntity: "task",
  linkPrefillFields: ["status"],
  fields: {
    taskIds: { type: "multiSelect", options: [], display: "count" },
    status: createSelectField({
      options: ["open", "inProgress", "blocked", "done"] as const,
      required: true,
    }),
  },
  layout: { sections: [{ fields: ["taskIds", "status"] }] },
  successFacts: [
    { field: "count", label: "Tasks changed" },
    { field: "statusKey", label: "New status", valueIsI18nKey: true },
  ],
};
