import { describe, expect, test } from "bun:test";
import {
  accountBalances,
  balanceSheet,
  incomeStatement,
  type LedgerAccount,
  type LedgerEntry,
} from "../reports";

// Pure report math — no DB. A small but complete set of books:
//   1. owner capital:  bank +500000 / equity −500000
//   2. rent income:    bank +100000 / rent  −100000
//   3. an expense:     expense +30000 / bank −30000
const accounts: LedgerAccount[] = [
  { id: "bank", name: "Bank", type: "asset" },
  { id: "equity", name: "Eigenkapital", type: "equity" },
  { id: "rent", name: "Mieterträge", type: "income" },
  { id: "expense", name: "Aufwand", type: "expense" },
  { id: "loan", name: "Darlehen", type: "liability" },
];

const posted: LedgerEntry[] = [
  {
    status: "posted",
    date: "2026-01-01",
    lines: [
      { accountId: "bank", amount: 500000 },
      { accountId: "equity", amount: -500000 },
    ],
  },
  {
    status: "posted",
    date: "2026-01-15",
    lines: [
      { accountId: "bank", amount: 100000 },
      { accountId: "rent", amount: -100000 },
    ],
  },
  {
    status: "posted",
    date: "2026-01-20",
    lines: [
      { accountId: "expense", amount: 30000 },
      { accountId: "bank", amount: -30000 },
    ],
  },
];

function balanceOf(report: ReturnType<typeof accountBalances>, id: string): number {
  return report.accounts.find((a) => a.id === id)?.balance ?? Number.NaN;
}

describe("accountBalances — natural balances + trial balance", () => {
  test("natural balances are sign-corrected by account type", () => {
    const r = accountBalances(accounts, posted);
    expect(balanceOf(r, "bank")).toBe(570000); // asset, debit-normal
    expect(balanceOf(r, "equity")).toBe(500000); // equity, credit-normal → flipped
    expect(balanceOf(r, "rent")).toBe(100000); // income, credit-normal → flipped
    expect(balanceOf(r, "expense")).toBe(30000); // expense, debit-normal
  });

  test("an account with no postings has a 0 balance", () => {
    expect(balanceOf(accountBalances(accounts, posted), "loan")).toBe(0);
  });

  test("the trial balance (Σ raw) is 0 — the golden invariant", () => {
    expect(accountBalances(accounts, posted).trialBalance).toBe(0);
  });

  test("draft entries never count toward the books", () => {
    const withDraft: LedgerEntry[] = [
      ...posted,
      {
        status: "draft",
        date: "2026-02-01",
        lines: [
          { accountId: "bank", amount: 999999 },
          { accountId: "rent", amount: -999999 },
        ],
      },
    ];
    expect(balanceOf(accountBalances(accounts, withDraft), "bank")).toBe(570000);
  });

  test("period filter excludes entries outside [from, to]", () => {
    // Only the rent entry (2026-01-15) falls inside.
    const r = accountBalances(accounts, posted, { from: "2026-01-10", to: "2026-01-18" });
    expect(balanceOf(r, "bank")).toBe(100000);
    expect(balanceOf(r, "rent")).toBe(100000);
    expect(r.trialBalance).toBe(0);
  });
});

describe("incomeStatement (GuV)", () => {
  test("income − expense = net income", () => {
    expect(incomeStatement(accounts, posted)).toEqual({
      income: 100000,
      expense: 30000,
      netIncome: 70000,
    });
  });
});

describe("balanceSheet (Bilanz)", () => {
  test("balances with the current result folded into equity", () => {
    const b = balanceSheet(accounts, posted);
    expect(b.assets).toBe(570000);
    expect(b.liabilities).toBe(0);
    expect(b.currentResult).toBe(70000); // laufendes Ergebnis
    expect(b.equity).toBe(570000); // 500000 capital + 70000 result
    expect(b.balances).toBe(true); // assets === liabilities + equity
  });

  test("balances even before any income/expense is closed (current result line)", () => {
    // Just the capital injection → assets 500000, equity 500000, result 0.
    const onlyCapital = [posted[0] as LedgerEntry];
    const b = balanceSheet(accounts, onlyCapital);
    expect(b.assets).toBe(500000);
    expect(b.currentResult).toBe(0);
    expect(b.balances).toBe(true);
  });
});
