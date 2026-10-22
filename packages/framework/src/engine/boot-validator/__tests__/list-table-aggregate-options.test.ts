import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import {
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
} from "../../factories.ts";
import type { ListColumnSpec } from "../../types/index.ts";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const LIST_QUERY = "shop:query:order:list";
const PLAIN_QUERY = "shop:query:order:rows";
const COLUMNS: readonly ListColumnSpec[] = [
  "name",
  "status",
  "amount",
  "qty",
  { field: "vaultKey", hideOnNarrow: true },
];

const orderEntity = createEntity({
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture" }),
    status: createSelectField({ options: ["open", "paid"] as const }),
    amount: createMoneyField({ filterable: true }),
    qty: createNumberField({ filterable: true }),
    vaultKey: createTextField({ personal: false, reason: "test_fixture", encrypted: true }),
  },
});

type ScreenKind = "entityList" | "projectionList" | "relatedList" | "expandableRow";
const KINDS: ScreenKind[] = ["entityList", "projectionList", "relatedList"];

type ScreenOptions = {
  readonly table?: unknown;
  readonly query?: string;
  readonly groupBy?: unknown;
  readonly facets?: unknown;
};

// The screen definitions are deliberately untyped: the boot validator is the net for
// JS and agent-authored features that the type system never sees.
function featureWith(kind: ScreenKind, options: ScreenOptions) {
  const { table, query = LIST_QUERY, groupBy, facets } = options;
  return defineFeature("shop", (r) => {
    r.crud("order", orderEntity, {
      write: { access: { roles: ["Admin"] } },
      read: { access: OPEN_TO_ALL },
    });
    r.queryHandler({
      name: "order:rows",
      schema: z.object({}),
      handler: async () => ({ rows: [], nextCursor: null }),
      access: OPEN_TO_ALL,
    });
    const tableBlock = table === undefined ? {} : { table };
    const relatedList = {
      kind: "relatedList",
      title: "Orders",
      query,
      columns: COLUMNS,
      ...tableBlock,
      ...(groupBy !== undefined && { groupBy }),
    };
    if (kind === "expandableRow") {
      r.screen({
        id: "order-list",
        type: "entityList",
        entity: "order",
        columns: ["name"],
        expandableRow: relatedList,
      } as never);
    } else if (kind === "entityList") {
      r.screen({
        id: "order-list",
        type: "entityList",
        entity: "order",
        columns: COLUMNS,
        ...tableBlock,
        ...(facets !== undefined && { facets }),
      } as never);
    } else if (kind === "projectionList") {
      r.screen({
        id: "order-rows",
        type: "projectionList",
        query,
        columns: COLUMNS,
        defaultSort: { field: "name", direction: "asc" },
        ...tableBlock,
      } as never);
    } else {
      r.screen({
        id: "order-detail",
        type: "projectionDetail",
        query: PLAIN_QUERY,
        layout: { sections: [relatedList] },
      } as never);
    }
  });
}

// The encrypted fixture field needs a key at boot; a fixed test key, removed after each test.
beforeEach(() => {
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = Buffer.from(
    "0123456789abcdef0123456789abcdef",
  ).toString("base64");
});

afterEach(() => {
  delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
});

describe("validateBoot — table.grouping and table.totals", () => {
  test.each(KINDS)("%s: grouping with userChoice and totals pass", (kind) => {
    const table = {
      grouping: { field: "status", userChoice: true, fields: ["name"], collapsedWhen: "paid" },
      totals: [
        { field: "amount", kind: "sum" },
        { field: "qty", kind: "avg" },
        { field: "name", kind: "count" },
      ],
    };
    validateBoot([featureWith(kind, { table })]);
  });

  test.each(KINDS)("%s: a field that is not a column is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { table: { totals: [{ field: "price", kind: "sum" }] } })]),
    ).toThrow(/table\.totals\[0\]\.field "price" is not a column of this screen/);
    expect(() =>
      validateBoot([featureWith(kind, { table: { grouping: { field: "customer" } } })]),
    ).toThrow(/table\.grouping field "customer" is not a column of this screen/);
  });

  test.each(KINDS)("%s: an encrypted or secret field is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { table: { grouping: { field: "vaultKey" } } })]),
    ).toThrow(/"vaultKey" is encrypted, personal or secret/);
  });

  test.each(KINDS)("%s: sum on a text field is rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { table: { totals: [{ field: "name", kind: "sum" }] } })]),
    ).toThrow(/"sum" is not supported on text field "name"/);
  });

  test.each(KINDS)("%s: a money field cannot be grouped by", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { table: { grouping: { field: "amount" } } })]),
    ).toThrow(/table\.grouping field "amount" \(money\) cannot be grouped by/);
  });

  test.each(KINDS)("%s: an unknown measure kind and unknown keys are rejected", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { table: { totals: [{ field: "qty", kind: "median" }] } })]),
    ).toThrow(/table\.totals\[0\]\.kind must be one of sum, avg, count, min, max/);
    expect(() =>
      validateBoot([
        featureWith(kind, { table: { grouping: { field: "status", dateField: "x" } } }),
      ]),
    ).toThrow(/table\.grouping has unknown key\(s\) "dateField"/);
  });

  test.each(KINDS)("%s: grouping without a field needs userChoice with fields", (kind) => {
    expect(() =>
      validateBoot([featureWith(kind, { table: { grouping: { userChoice: true } } })]),
    ).toThrow(/table\.grouping has no field/);
    expect(() =>
      validateBoot([featureWith(kind, { table: { grouping: { fields: ["status"] } } })]),
    ).toThrow(/table\.grouping has no field/);
  });

  test.each(["projectionList", "relatedList"] as const)(
    "%s: grouping on a query without aggregate in its schema is rejected",
    (kind) => {
      expect(() =>
        validateBoot([
          featureWith(kind, { query: PLAIN_QUERY, table: { grouping: { field: "status" } } }),
        ]),
      ).toThrow(
        /table\.grouping\/table\.totals need query "shop:query:order:rows" to accept "aggregate"/,
      );
    },
  );

  test.each(["relatedList", "expandableRow"] as const)(
    "%s: the removed groupBy is rejected with a pointer to table.grouping",
    (kind) => {
      const groupBy = { field: "status", label: "shop.group" };
      expect(() => validateBoot([featureWith(kind, { groupBy })])).toThrow(
        /uses groupBy, which was removed\. Use table\.grouping/,
      );
    },
  );
});

describe("validateBoot — table.grouping on an expandableRow", () => {
  test("a fixed grouping field passes", () => {
    const grouping = { field: "status", collapsedWhen: "paid", labels: { paid: "shop.paid" } };
    expect(() =>
      validateBoot([featureWith("expandableRow", { table: { grouping } })]),
    ).not.toThrow();
  });

  test("the bound query must accept aggregate", () => {
    expect(() =>
      validateBoot([
        featureWith("expandableRow", {
          query: PLAIN_QUERY,
          table: { grouping: { field: "status" } },
        }),
      ]),
    ).toThrow(/need query "shop:query:order:rows" to accept "aggregate"/);
  });

  test.each(["userChoice", "fields"] as const)("grouping.%s is rejected", (key) => {
    const grouping = { field: "status", [key]: key === "userChoice" ? true : ["name"] };
    expect(() => validateBoot([featureWith("expandableRow", { table: { grouping } })])).toThrow(
      new RegExp(`does not support table\\.grouping\\.${key}`),
    );
  });

  test("totals and the other table options are rejected", () => {
    expect(() =>
      validateBoot([
        featureWith("expandableRow", {
          table: { grouping: { field: "status" }, totals: [{ field: "qty", kind: "sum" }] },
        }),
      ]),
    ).toThrow(/supports only table\.grouping, not table\.totals/);
  });
});

describe("validateBoot — range facets", () => {
  test("a filterable number or money field takes display range", () => {
    const facets = { qty: { display: "range" }, amount: { display: "range" } };
    expect(() => validateBoot([featureWith("entityList", { facets })])).not.toThrow();
  });

  test("display range on a text or a non-filterable field is rejected", () => {
    expect(() =>
      validateBoot([featureWith("entityList", { facets: { name: { display: "range" } } })]),
    ).toThrow(/facets\.name: display "range" needs a number, decimal, money or bigInt field/);
  });
});
