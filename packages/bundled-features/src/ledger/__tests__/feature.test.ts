import { describe, expect, test } from "bun:test";
import { DEFAULT_LEDGER_ROLES } from "../constants";
import { createLedgerFeature } from "../feature";
import { createTransactionPayloadSchema, reverseTransactionPayloadSchema } from "../schemas";

// Unit tests: feature-shape, role-options, and the two double-entry invariants
// that live in the command schema (balance + ≥2 accounts). The ES-loop behaviour
// (posting projection, Storno, tenant-isolation) needs a real stack →
// ledger.integration.test.ts.

function writeAccess(
  feature: ReturnType<typeof createLedgerFeature>,
  nameMatch: string,
): readonly string[] {
  const entry = Object.entries(feature.writeHandlers).find(([qn]) => qn.includes(nameMatch));
  if (!entry) throw new Error(`handler ${nameMatch} not registered`);
  const access = entry[1].access;
  if (!access || !("roles" in access)) throw new Error(`handler ${nameMatch} has no roles`);
  return access.roles;
}

describe("createLedgerFeature shape", () => {
  test("registers account + transaction + schedule entities, 7 write-handlers, 9 query-handlers", () => {
    const feature = createLedgerFeature();

    expect(Object.keys(feature.entities ?? {})).toEqual(
      expect.arrayContaining(["account", "transaction", "schedule"]),
    );

    expect(Object.keys(feature.writeHandlers)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/account:create/),
        expect.stringMatching(/account:update/),
        expect.stringMatching(/create-transaction/),
        expect.stringMatching(/reverse-transaction/),
        expect.stringMatching(/schedule:create/),
        expect.stringMatching(/schedule:update/),
        expect.stringMatching(/confirm-schedule-period/),
      ]),
    );
    expect(Object.keys(feature.writeHandlers)).toHaveLength(7);

    expect(Object.keys(feature.queryHandlers)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/account:list/),
        expect.stringMatching(/account:detail/),
        expect.stringMatching(/transaction:list/),
        expect.stringMatching(/transaction:detail/),
        expect.stringMatching(/schedule:list/),
        expect.stringMatching(/schedule:detail/),
        expect.stringMatching(/report:balances/),
        expect.stringMatching(/report:income-statement/),
        expect.stringMatching(/report:balance-sheet/),
      ]),
    );
    expect(Object.keys(feature.queryHandlers)).toHaveLength(9);
  });

  test("transaction is immutable: NO update/delete handler is registered", () => {
    const feature = createLedgerFeature();
    const writeQns = Object.keys(feature.writeHandlers);
    expect(writeQns.some((qn) => qn.includes("transaction:update"))).toBe(false);
    expect(writeQns.some((qn) => qn.includes("transaction:delete"))).toBe(false);
  });

  test("account has no delete handler in v1 (postings-aware guard deferred)", () => {
    const feature = createLedgerFeature();
    expect(Object.keys(feature.writeHandlers).some((qn) => qn.includes("account:delete"))).toBe(
      false,
    );
  });
});

describe("createLedgerFeature access-options", () => {
  test("without options: singleton with default roles on every path", () => {
    const feature = createLedgerFeature();
    expect(feature).toBe(createLedgerFeature());
    for (const path of ["account:create", "create-transaction", "reverse-transaction"]) {
      expect(writeAccess(feature, path)).toEqual([...DEFAULT_LEDGER_ROLES]);
    }
  });

  test("roles option overrides every write-path", () => {
    const feature = createLedgerFeature({ roles: ["Accountant"] });
    expect(writeAccess(feature, "create-transaction")).toEqual(["Accountant"]);
    expect(writeAccess(feature, "account:create")).toEqual(["Accountant"]);
  });

  test("toggleable:{default:false} makes the feature tier-gatable, fail-closed", () => {
    const feature = createLedgerFeature({ toggleable: { default: false } });
    expect(feature.toggleableDefault).toBe(false);
  });
});

describe("createTransactionPayloadSchema — double-entry invariants", () => {
  const ok = {
    date: "2026-01-15",
    description: "Miete Januar",
    lines: [
      { accountId: "acc-bank", amount: 100000 },
      { accountId: "acc-rent-income", amount: -100000 },
    ],
  };

  test("accepts a balanced entry across two accounts", () => {
    expect(createTransactionPayloadSchema.safeParse(ok).success).toBe(true);
  });

  test("rejects an unbalanced entry (Σ ≠ 0)", () => {
    const bad = {
      ...ok,
      lines: [
        { accountId: "acc-bank", amount: 100000 },
        { accountId: "acc-rent-income", amount: -90000 },
      ],
    };
    expect(createTransactionPayloadSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects fewer than 2 lines", () => {
    const bad = { ...ok, lines: [{ accountId: "acc-bank", amount: 0 }] };
    expect(createTransactionPayloadSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects 2 balanced lines on the SAME account (no value moved)", () => {
    const bad = {
      ...ok,
      lines: [
        { accountId: "acc-bank", amount: 100000 },
        { accountId: "acc-bank", amount: -100000 },
      ],
    };
    expect(createTransactionPayloadSchema.safeParse(bad).success).toBe(false);
  });

  test("rejects non-integer amounts (cents are integers)", () => {
    const bad = {
      ...ok,
      lines: [
        { accountId: "acc-bank", amount: 1000.5 },
        { accountId: "acc-rent-income", amount: -1000.5 },
      ],
    };
    expect(createTransactionPayloadSchema.safeParse(bad).success).toBe(false);
  });

  test("accepts a balanced split across three accounts (e.g. credit rate)", () => {
    const split = {
      date: "2026-01-01",
      description: "Kreditrate (Zins + Tilgung)",
      lines: [
        { accountId: "acc-bank", amount: -150000 }, // Zahlung raus
        { accountId: "acc-interest-expense", amount: 50000 }, // Zins
        { accountId: "acc-loan-liability", amount: 100000 }, // Tilgung mindert Schuld
      ],
    };
    expect(createTransactionPayloadSchema.safeParse(split).success).toBe(true);
  });
});

describe("reverseTransactionPayloadSchema", () => {
  test("accepts an id-only Storno request", () => {
    expect(reverseTransactionPayloadSchema.safeParse({ id: "tx-1" }).success).toBe(true);
  });

  test("rejects a missing id", () => {
    expect(reverseTransactionPayloadSchema.safeParse({}).success).toBe(false);
  });
});
