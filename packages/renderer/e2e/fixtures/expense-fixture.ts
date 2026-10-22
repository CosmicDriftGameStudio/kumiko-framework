// Expenses for the server-side grouping, totals and range facet specs: more
// rows than one page per status, so every header count and sum is something
// only the aggregate answer can know.

import type {
  EntityDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

export const expenseEntity = {
  fields: {
    title: { type: "text", required: true, sortable: true },
    status: { type: "select", options: ["open", "approved", "paid"], sortable: true },
    category: { type: "select", options: ["travel", "office", "software"], sortable: true },
    amount: { type: "money", currency: { kind: "literal", code: "EUR" }, sortable: true },
    reportId: { type: "text" },
  },
} as unknown as EntityDefinition;

export const EXPENSE_PAGE_SIZE = 5;

const groupedTable: EntityListScreenDefinition["table"] = {
  grouping: { field: "status", collapsedWhen: "paid", userChoice: true, fields: ["category"] },
  totals: [{ field: "amount", kind: "sum" }],
};

const expenseListBase = {
  type: "entityList",
  entity: "expense",
  columns: ["title", "status", "category", "amount"],
  defaultSort: { field: "title", dir: "asc" },
  pageSize: EXPENSE_PAGE_SIZE,
  facets: { amount: { display: "range" } },
} as const;

export const expenseListScreen: EntityListScreenDefinition = {
  ...expenseListBase,
  id: "expense-list",
  pagination: "pages",
  table: groupedTable,
};

export const expenseFeedScreen: EntityListScreenDefinition = {
  ...expenseListBase,
  id: "expense-feed",
  pagination: "infinite",
  table: groupedTable,
};

const ledgerTable: EntityListScreenDefinition["table"] = {
  totals: [{ field: "amount", kind: "sum" }],
};

export const expenseLedgerScreen: EntityListScreenDefinition = {
  ...expenseListBase,
  id: "expense-ledger",
  pagination: "pages",
  table: ledgerTable,
};

export const expenseLedgerFeedScreen: EntityListScreenDefinition = {
  ...expenseListBase,
  id: "expense-ledger-feed",
  pagination: "infinite",
  table: ledgerTable,
};

const TITLES = ["Train", "Hotel", "Paper", "Laptop", "Licence", "Taxi", "Lunch", "Toner", "Cloud"];
const STATUS_COUNTS = { open: 12, approved: 7, paid: 9 } as const;
const CATEGORIES = ["travel", "office", "software"] as const;

/** 28 expenses; amount i×10.50 EUR so every sum is exact and distinct. */
export const EXPENSE_ROWS = Object.entries(STATUS_COUNTS).flatMap(([status, count], statusIndex) =>
  Array.from({ length: count }, (_, index) => {
    const n = statusIndex * 100 + index + 1;
    return {
      id: `exp-${String(n).padStart(3, "0")}`,
      title: `${TITLES[n % TITLES.length]} ${String(n).padStart(3, "0")}`,
      status,
      category: CATEGORIES[n % CATEGORIES.length],
      amount: { amount: (index + 1) * 10.5, currency: "EUR" },
    };
  }),
);

/** Sum in EUR over the rows the predicate keeps; mirrors what the server answers. */
export function expenseSum(keep: (row: (typeof EXPENSE_ROWS)[number]) => boolean): number {
  return EXPENSE_ROWS.filter(keep).reduce((sum, row) => sum + row.amount.amount, 0);
}

export const expenseTranslations = {
  "test:entity:expense:field:title": { en: "Title", de: "Titel" },
  "test:entity:expense:field:status": { en: "Status", de: "Status" },
  "test:entity:expense:field:category": { en: "Category", de: "Kategorie" },
  "test:entity:expense:field:amount": { en: "Amount", de: "Betrag" },
};

export const expenseScreens = [
  expenseListScreen,
  expenseFeedScreen,
  expenseLedgerScreen,
  expenseLedgerFeedScreen,
];
