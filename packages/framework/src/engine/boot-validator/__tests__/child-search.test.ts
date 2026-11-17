// Boot guard for searchable hasMany relations: the target must exist, the foreign key must be a
// field of the target and the target needs something a search term can match.

import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature.ts";
import { createEntity, createReferenceField, createTextField } from "../../factories.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { validateChildSearchRelations } from "../child-search.ts";

const ticketEntity = createEntity({
  name: "ticket",
  table: "read_tickets",
  fields: { subject: createTextField({ personal: false, reason: "test_fixture" }) },
});

function replyEntity(searchable: boolean) {
  return createEntity({
    name: "reply",
    table: "read_replies",
    fields: {
      ticketId: createReferenceField({ entity: "ticket", personal: false, reason: "test_fixture" }),
      body: createTextField({ personal: false, reason: "test_fixture", searchable }),
    },
  });
}

function helpdesk(options: {
  target: string;
  foreignKey: string;
  searchableBody: boolean;
}): FeatureDefinition {
  return defineFeature("helpdesk", (r) => {
    const ticket = r.entity(ticketEntity);
    r.entity(replyEntity(options.searchableBody));
    r.relation({ entity: ticket, name: "replies", type: "hasMany",
      target: options.target,
      foreignKey: options.foreignKey,
      searchable: true });
  });
}

function validate(feature: FeatureDefinition): void {
  validateChildSearchRelations(feature, new Map([[feature.name, feature]]));
}

describe("validateChildSearchRelations", () => {
  test("accepts a target with a searchable field and a real foreign key", () => {
    expect(() =>
      validate(helpdesk({ target: "reply", foreignKey: "ticketId", searchableBody: true })),
    ).not.toThrow();
  });

  test("rejects an unknown target entity", () => {
    expect(() =>
      validate(helpdesk({ target: "ghost", foreignKey: "ticketId", searchableBody: true })),
    ).toThrow(/unknown entity "ghost"/);
  });

  test("rejects a foreign key that is not a field of the target", () => {
    expect(() =>
      validate(helpdesk({ target: "reply", foreignKey: "missingId", searchableBody: true })),
    ).toThrow(/no field "missingId"/);
  });

  test("rejects a target without a searchable field", () => {
    expect(() =>
      validate(helpdesk({ target: "reply", foreignKey: "ticketId", searchableBody: false })),
    ).toThrow(/no searchable field/);
  });
});
