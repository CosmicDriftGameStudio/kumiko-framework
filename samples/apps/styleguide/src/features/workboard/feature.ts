import {
  createDateField,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

import { WORKBOARD_I18N } from "./i18n";

export const taskEntity = createEntity({
  table: "read_workboard_tasks",
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
    estimateHours: createNumberField({ sortable: true }),
  },
});

const open = {
  access: {
    openToAll: {
      reason: "demo app: any signed-in user manages every task; there is no per-user ownership",
    },
  },
} as const;

// All of this round's list options on one screen: remembered state, one reset
// button, the column picker (estimateHours starts hidden) and the density choice.
export const workboardFeature = defineFeature("workboard", (r) => {
  r.translations({ keys: WORKBOARD_I18N });
  r.crud("task", taskEntity, { write: open, read: open });

  r.screen({
    id: "task-list",
    type: "entityList",
    entity: "task",
    columns: [
      "title",
      "status",
      "priority",
      { field: "dueDate", hideOnNarrow: true },
      { field: "assignee", hideOnNarrow: true },
      { field: "estimateHours", hidden: true, hideOnNarrow: true },
    ],
    pagination: "pages",
    pageSize: 25,
    defaultSort: { field: "dueDate", dir: "asc" },
    searchable: true,
    facets: { status: { display: "chips" }, priority: {} },
    table: {
      rememberState: true,
      resetAll: true,
      columnPicker: true,
      density: { default: "comfortable", userChoice: true },
    },
    rowActions: [
      { kind: "navigate", id: "edit", label: "Edit", screen: "task-edit", rowClick: true },
    ],
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

  r.nav({ id: "workboard", label: "workboard:nav.workboard", icon: "list", order: 40 });
  r.nav({
    id: "task-list",
    label: "workboard:nav.tasks",
    parent: "workboard:nav:workboard",
    screen: "workboard:screen:task-list",
    icon: "table",
    order: 10,
  });
});
