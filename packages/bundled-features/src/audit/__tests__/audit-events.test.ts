import { describe, expect, test } from "bun:test";
import { PII_CIPHERTEXT_PREFIX } from "@cosmicdrift/kumiko-framework/crypto";
import { REDACTED_PII_PLACEHOLDER } from "../../shared/index.ts";
import { serializeAuditEvent } from "../handlers/audit-events.ts";

describe("serializeAuditEvent", () => {
  test("replaces PII ciphertext in the metadata as well as in the payload", () => {
    const ciphertext = `${PII_CIPHERTEXT_PREFIX}abc`;
    const event = serializeAuditEvent({
      id: 7n,
      tenantId: "t",
      aggregateId: "a",
      aggregateType: "x",
      version: 1,
      type: "x.created",
      payload: { name: ciphertext },
      metadata: { userId: "u", note: ciphertext },
      createdAt: null,
      createdBy: "u",
    });

    expect(event.payload).toEqual({ name: REDACTED_PII_PLACEHOLDER });
    expect(event.metadata).toEqual({ userId: "u", note: REDACTED_PII_PLACEHOLDER });
  });
});
