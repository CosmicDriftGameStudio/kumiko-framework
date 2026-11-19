import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature.ts";
import {
  createEmbeddedField,
  createEntity,
  createMoneyField,
  createTextField,
} from "../../factories.ts";
import { FIELD_CHANGE_REQUEST_ENTITY_NAME } from "../../field-approval.ts";
import type { FieldDefinition } from "../../types/fields.ts";
import type { FeatureDefinition } from "../../types/index.ts";
import { BootRuleViolation } from "../boot-rule.ts";
import { validateFieldApproval } from "../field-approval.ts";

const text = () =>
  createTextField({
    required: true,
    maxLength: 64,
    personal: false,
    reason: "technical_reference",
  });

const requestEntity = (allowedTypes: readonly string[]) =>
  createEntity({
    name: FIELD_CHANGE_REQUEST_ENTITY_NAME,
    table: "read_fa_boot_requests",
    fields: { entityType: text(), entityId: text() },
    parentRef: { entityTypeField: "entityType", entityIdField: "entityId", allowedTypes },
  });

function check(
  ibanField: FieldDefinition,
  opts: { requests?: readonly string[] | undefined } = { requests: ["contact"] },
): void {
  const fa = defineFeature("fa", (r) => {
    r.entity(
      createEntity({
        name: "contact",
        table: "read_fa_boot_contacts",
        fields: { iban: ibanField },
      }),
    );
    if (opts.requests !== undefined) {
      r.entity(requestEntity(opts.requests));
    }
  });
  const features: FeatureDefinition[] = [fa];
  validateFieldApproval(fa, new Map(features.map((f) => [f.name, f] as const)), undefined);
}

function ruleIdOfThrown(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BootRuleViolation) return error.rule.id;
    throw error;
  }
  throw new Error("expected function to throw");
}

const gatedText = (access: { write?: readonly string[]; approve: readonly string[] }) =>
  createTextField({ maxLength: 34, personal: false, reason: "technical_reference", access });

describe("validateFieldApproval", () => {
  test("accepts approve roles that may write the field", () => {
    expect(() =>
      check(gatedText({ approve: ["Accountant"], write: ["Accountant", "PM"] })),
    ).not.toThrow();
  });

  test("rejects empty approve", () => {
    expect(ruleIdOfThrown(() => check(gatedText({ approve: [] })))).toBe(
      "field-approval/approve-roles-empty",
    );
  });

  test("rejects an approve role outside write", () => {
    expect(ruleIdOfThrown(() => check(gatedText({ approve: ["Accountant"], write: ["PM"] })))).toBe(
      "field-approval/approve-outside-write",
    );
  });

  test("rejects approve without access.write", () => {
    expect(ruleIdOfThrown(() => check(gatedText({ approve: ["Accountant"] })))).toBe(
      "field-approval/needs-write",
    );
  });

  test("rejects approve on an encrypted field without a subject", () => {
    const encrypted = createTextField({
      maxLength: 34,
      personal: false,
      reason: "technical_reference",
      encrypted: true,
      access: { approve: ["Accountant"], write: ["Accountant"] },
    });
    expect(ruleIdOfThrown(() => check(encrypted))).toBe("field-approval/secret-field");
  });

  test("accepts approve on a subject-encrypted field", () => {
    const sealed = createTextField({
      maxLength: 34,
      personal: "self",
      find: "secret",
      access: { approve: ["Accountant"], write: ["Accountant"] },
    });
    expect(() => check(sealed)).not.toThrow();
  });

  test("rejects approve on a non-scalar field", () => {
    expect(
      ruleIdOfThrown(() => check(createMoneyField({ access: { approve: ["Accountant"] } }))),
    ).toBe("field-approval/field-type");
  });

  test("rejects approve on an embedded sub-field", () => {
    const embedded = createEmbeddedField({
      iban: { type: "text", access: { approve: ["Accountant"] } },
    });
    expect(ruleIdOfThrown(() => check(embedded))).toBe("field-approval/embedded-sub-field");
  });

  test("rejects approve without the request entity", () => {
    expect(
      ruleIdOfThrown(() =>
        check(gatedText({ approve: ["Accountant"], write: ["Accountant"] }), {
          requests: undefined,
        }),
      ),
    ).toBe("field-approval/needs-feature");
  });

  test("rejects approve when the host is not among the parents", () => {
    expect(
      ruleIdOfThrown(() =>
        check(gatedText({ approve: ["Accountant"], write: ["Accountant"] }), {
          requests: ["other"],
        }),
      ),
    ).toBe("field-approval/needs-feature");
  });
});
