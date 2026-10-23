// Expense reports whose expanded row groups its expenses by status, and a
// bulk list that combines groups, totals and the checkbox column under a
// pinned title. The two reports hold different counts per status, so a
// header count can only come from the aggregate scoped to its parent.

import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { EXPENSE_PAGE_SIZE, EXPENSE_ROWS } from "./expense-fixture";

export const reportEntity = {
  fields: {
    name: { type: "text", required: true, sortable: true },
  },
} as unknown as EntityDefinition;

export const REPORT_ROWS = [
  { id: "rep-a", name: "Report A" },
  { id: "rep-b", name: "Report B" },
];

/** Every third expense belongs to Report B, the rest to Report A. */
export const REPORT_EXPENSE_ROWS = EXPENSE_ROWS.map((row, index) => ({
  ...row,
  reportId: index % 3 === 0 ? "rep-b" : "rep-a",
}));

export function reportExpenseCount(reportId: string, status: string): number {
  return REPORT_EXPENSE_ROWS.filter((row) => row.reportId === reportId && row.status === status)
    .length;
}

export const ARCHIVE_EXPENSE_HANDLER = "test:write:expense:archive";

export const reportListScreen: EntityListScreenDefinition = {
  id: "report-list",
  type: "entityList",
  entity: "report",
  columns: ["name"],
  defaultSort: { field: "name", dir: "asc" },
  expandableRow: {
    kind: "relatedList",
    title: "Expenses",
    query: "test:query:expense:list",
    entity: "expense",
    parentFilter: { field: "reportId" },
    columns: ["title", "status", "amount"],
    pageSize: EXPENSE_PAGE_SIZE,
    table: { grouping: { field: "status", collapsedWhen: "paid" } },
  },
};

export const expenseBulkScreen: EntityListScreenDefinition = {
  id: "expense-bulk",
  type: "entityList",
  entity: "expense",
  columns: [{ field: "title", pinned: "left" }, "status", "category", "amount"],
  defaultSort: { field: "title", dir: "asc" },
  pageSize: EXPENSE_PAGE_SIZE,
  table: {
    pinning: true,
    grouping: { field: "status", collapsedWhen: "paid" },
    totals: [{ field: "amount", kind: "sum" }],
  },
  rowActions: [{ id: "archive", label: "Archive", handler: ARCHIVE_EXPENSE_HANDLER }],
  bulkActions: [{ id: "archive", rowAction: "archive" }],
};

export const reportTranslations = {
  "screen:report-list.title": { en: "Expense reports", de: "Spesenberichte" },
  "screen:expense-bulk.title": { en: "Expenses", de: "Ausgaben" },
  "test:entity:report:field:name": { en: "Name", de: "Name" },
};

export const reportScreens = [reportListScreen, expenseBulkScreen];
