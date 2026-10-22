import type { ListAggregateValue } from "@cosmicdrift/kumiko-types/list-aggregate-types";
import { defineFeature } from "../../engine/define-feature.ts";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "../../engine/factories.ts";
import { from } from "../../engine/ownership.ts";

export const customerEntity = createEntity({
  table: "agg_customers",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});

export const orderEntity = createEntity({
  table: "agg_orders",
  access: { read: { Admin: "all", User: from("user:id", "ownerId") } },
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", searchable: true }),
    category: createTextField({ personal: false, reason: "test_fixture" }),
    status: createSelectField({ options: ["open", "paid"] as const }),
    qty: createNumberField(),
    rush: createBooleanField(),
    amount: createMoneyField(),
    placedAt: createTimestampField(),
    dueOn: createDateField(),
    customerId: { type: "reference", entity: "customer", labelField: "name" },
    ownerId: createTextField({ personal: false, reason: "test_fixture", required: true }),
    fieldOwnerId: createTextField({ personal: false, reason: "test_fixture" }),
    adminOnly: createNumberField({ access: { read: { Admin: "all" } } }),
    rowOwnedQty: createNumberField({
      access: { read: { Admin: "all", User: from("user:id", "fieldOwnerId") } },
    }),
    rowOwnedGroup: createTextField({
      personal: false,
      reason: "test_fixture",
      access: { read: { Admin: "all", User: from("user:id", "fieldOwnerId") } },
    }),
    vaultKey: createTextField({ personal: false, reason: "test_fixture", sensitive: true }),
  },
});

export const aggFeature = defineFeature("agg", (r) => {
  r.crud("customer", customerEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
  r.crud("order", orderEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  });
});

export const LIST_ORDERS = "agg:query:order:list";
export const CREATE_ORDER = "agg:write:order:create";
export const CREATE_CUSTOMER = "agg:write:customer:create";

export type AggGroup = {
  readonly key: string | number | boolean | null;
  readonly label?: string | null;
  readonly count: number;
  readonly measures: readonly ListAggregateValue[];
};

export type AggResult = {
  readonly groups: readonly AggGroup[];
  readonly truncated?: true;
  readonly searchTruncated?: true;
};
