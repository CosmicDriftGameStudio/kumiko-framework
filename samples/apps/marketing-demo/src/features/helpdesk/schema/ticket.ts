// Helpdesk-Tickets Schema. Internal-Tools-Klassiker neben Asset-Tracker.
// Beweist: ein Framework, viele kleine Apps — keine separate Codebase
// pro Tool. Schema-driven Form + Liste mit Severity-Badges.

import {
  createDateField,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

export const TICKET_CATEGORIES = [
  "hardware",
  "software",
  "account",
  "network",
  "license",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

export const TICKET_STATUSES = ["open", "investigating", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_DEPARTMENTS = [
  "it",
  "marketing",
  "sales",
  "engineering",
  "finance",
  "hr",
] as const;
export type TicketDepartment = (typeof TICKET_DEPARTMENTS)[number];

export const ticketEntity = createEntity({
  fields: {
    title: createTextField({ required: true, sortable: true, searchable: true }),
    description: createTextField({ multiline: { rows: 4 }, searchable: true }),
    category: createSelectField({
      options: TICKET_CATEGORIES,
      default: "other",
      sortable: true,
      filterable: true,
    }),
    severity: createSelectField({
      options: TICKET_SEVERITIES,
      default: "medium",
      sortable: true,
      filterable: true,
    }),
    status: createSelectField({
      options: TICKET_STATUSES,
      default: "open",
      sortable: true,
      filterable: true,
    }),
    department: createSelectField({
      options: TICKET_DEPARTMENTS,
      default: "it",
      sortable: true,
      filterable: true,
    }),
    reporter: createTextField({ sortable: true, searchable: true }),
    assignee: createTextField({ sortable: true, searchable: true }),
    dueDate: createDateField({ sortable: true }),
    spentMinutes: createNumberField({ sortable: true }),
  },
});

export const ticketEditScreen: EntityEditScreenDefinition = {
  id: "ticket-edit",
  type: "entityEdit",
  entity: "ticket",
  layout: {
    sections: [
      {
        title: "helpdesk:section.ticket",
        columns: 2,
        fields: [
          { field: "title", span: 2 },
          "category",
          "severity",
          "status",
          "department",
          { field: "description", span: 2 },
        ],
      },
      {
        title: "helpdesk:section.people",
        columns: 2,
        fields: ["reporter", "assignee"],
      },
      {
        title: "helpdesk:section.tracking",
        columns: 2,
        fields: ["dueDate", "spentMinutes"],
      },
    ],
  },
};

export const ticketListScreen: EntityListScreenDefinition = {
  id: "ticket-list",
  type: "entityList",
  entity: "ticket",
  columns: [
    "title",
    "category",
    "severity",
    "status",
    "department",
    "assignee",
    "reporter",
    "dueDate",
    "spentMinutes",
  ],
  pageSize: 25,
  defaultSort: { field: "severity", dir: "desc" },
};
