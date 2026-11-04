// The read-model entities and event schemas hold PII ciphertext, which is longer than the plaintext
// limits: a field at its plaintext maximum must still pass validation. "€" is 3 UTF-8 bytes per
// UTF-16 unit, the worst case the limits are sized for.

import { afterEach, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  encryptPiiFieldValues,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import { buildInsertSchema, type EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  PAYMENT_PII_FIELDS,
  paymentEntity,
  SUBSCRIPTION_PII_FIELDS,
  subscriptionEntity,
} from "../../billing-foundation/entities.ts";
import {
  PAYMENT_AGGREGATE_TYPE,
  paymentEventPayloadSchema,
  SUBSCRIPTION_AGGREGATE_TYPE,
  subscriptionEventPayloadSchema,
} from "../../billing-foundation/events.ts";
import {
  INBOUND_MESSAGE_PII_FIELDS,
  inboundMessageEntity,
  MAIL_ACCOUNT_PII_FIELDS,
  MAIL_THREAD_PII_FIELDS,
  mailAccountEntity,
  mailThreadEntity,
} from "../entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_THREAD_AGGREGATE_TYPE,
  mailAccountEventPayloadSchema,
} from "../events.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

async function encryptedAtLimit(
  entity: EntityDefinition,
  entityName: string,
  piiFields: readonly string[],
  limits: Readonly<Record<string, number>>,
): Promise<Record<string, unknown>> {
  const kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  const plain = Object.fromEntries(
    Object.entries(limits).map(([name, limit]) => [name, "€".repeat(limit)]),
  );
  return encryptPiiFieldValues(
    { tenantId: TENANT_ID, ...plain },
    entity,
    piiFields,
    kms,
    { requestId: "entity-ciphertext-limits", tenantId: TENANT_ID },
    { tenantId: TENANT_ID, entityName },
  );
}

describe("entity field limits for PII ciphertext", () => {
  test("inbound message PII fields at their plaintext maximum validate", async () => {
    const encrypted = await encryptedAtLimit(
      inboundMessageEntity,
      INBOUND_MESSAGE_AGGREGATE_TYPE,
      INBOUND_MESSAGE_PII_FIELDS,
      { from: 2000, to: 8000, cc: 8000, subject: 4000, snippet: 4000, bodyText: 32_000 },
    );
    const shape = buildInsertSchema(inboundMessageEntity).shape;
    for (const name of ["from", "to", "cc", "subject", "snippet", "bodyText"]) {
      const result = shape[name]?.safeParse(encrypted[name]);
      expect({ name, success: result?.success }).toEqual({ name, success: true });
    }
  });

  test("account address at its plaintext maximum validates against entity and event schema", async () => {
    const encrypted = await encryptedAtLimit(
      mailAccountEntity,
      MAIL_ACCOUNT_AGGREGATE_TYPE,
      MAIL_ACCOUNT_PII_FIELDS,
      { address: 320 },
    );
    const entityResult = buildInsertSchema(mailAccountEntity).shape["address"]?.safeParse(
      encrypted["address"],
    );
    expect(entityResult?.success).toBe(true);
    const eventResult = mailAccountEventPayloadSchema.shape.address.safeParse(encrypted["address"]);
    expect(eventResult.success).toBe(true);
  });

  test("thread subject at its plaintext maximum validates", async () => {
    const encrypted = await encryptedAtLimit(
      mailThreadEntity,
      MAIL_THREAD_AGGREGATE_TYPE,
      MAIL_THREAD_PII_FIELDS,
      { subject: 4000 },
    );
    const result = buildInsertSchema(mailThreadEntity).shape["subject"]?.safeParse(
      encrypted["subject"],
    );
    expect(result?.success).toBe(true);
  });

  test("billing event provider ids at 200 characters validate", async () => {
    const subscription = await encryptedAtLimit(
      subscriptionEntity,
      SUBSCRIPTION_AGGREGATE_TYPE,
      SUBSCRIPTION_PII_FIELDS,
      { providerCustomerId: 200, providerSubscriptionId: 200 },
    );
    const payment = await encryptedAtLimit(
      paymentEntity,
      PAYMENT_AGGREGATE_TYPE,
      PAYMENT_PII_FIELDS,
      {
        providerCustomerId: 200,
      },
    );
    const customerId = subscription["providerCustomerId"];
    const subscriptionId = subscription["providerSubscriptionId"];
    expect(
      subscriptionEventPayloadSchema.shape.providerCustomerId.safeParse(customerId).success,
    ).toBe(true);
    expect(
      subscriptionEventPayloadSchema.shape.providerSubscriptionId.safeParse(subscriptionId).success,
    ).toBe(true);
    expect(
      paymentEventPayloadSchema.shape.providerCustomerId.safeParse(payment["providerCustomerId"])
        .success,
    ).toBe(true);
  });
});
