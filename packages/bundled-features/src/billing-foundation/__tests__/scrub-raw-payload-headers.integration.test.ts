// Billing events written before the provider payload was dropped carry it as the plaintext header
// `rawPayload`. The boot job removes it from every billing event type and keeps the other headers.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
  SUBSCRIPTION_AGGREGATE_TYPE,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
} from "../events.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import { BILLING_FOUNDATION_FEATURE } from "../web/constants.ts";

const SCRUB_JOB = `${BILLING_FOUNDATION_FEATURE}:job:scrub-raw-payload-headers`;
const RAW_PAYLOAD = '{"data":{"customer":{"email":"ada@example.com"}}}';
const BILLING_EVENT_TYPES = [
  SUBSCRIPTION_CREATED_EVENT_QN,
  SUBSCRIPTION_UPDATED_EVENT_QN,
  SUBSCRIPTION_CANCELED_EVENT_QN,
  INVOICE_PAID_EVENT_QN,
  INVOICE_PAYMENT_FAILED_EVENT_QN,
] as const;

describe("billing-foundation scrub-raw-payload-headers job", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        createBillingFoundationFeature({}),
      ],
      jobs: { consumerLane: "worker" },
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function appendLegacyEvent(
    type: string,
    tenantNumber: number,
    headers: Record<string, string>,
  ): Promise<string> {
    const aggregateId = crypto.randomUUID();
    await append(stack.db, {
      aggregateId,
      aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
      tenantId: testTenantId(tenantNumber),
      expectedVersion: 0,
      type,
      payload: { status: "active" },
      metadata: { userId: "1", headers },
    });
    return aggregateId;
  }

  async function headersOf(aggregateId: string): Promise<Record<string, unknown>> {
    const rows = await asRawClient(stack.db).unsafe<{ headers: Record<string, unknown> }>(
      `SELECT "metadata"->'headers' AS headers FROM "kumiko_events" WHERE "aggregate_id" = $1`,
      [aggregateId],
    );
    return rows[0]?.headers ?? {};
  }

  async function runScrubJob(): Promise<void> {
    await stack.jobRunner?.dispatch(SCRUB_JOB, {});
    await stack.drainJobs();
  }

  test("removes rawPayload from every billing event type, across tenants, and keeps other headers; a rerun changes nothing", async () => {
    const billing: string[] = [];
    for (const [index, type] of BILLING_EVENT_TYPES.entries()) {
      billing.push(
        await appendLegacyEvent(type, index + 1, {
          providerEventId: `evt_${index}`,
          providerName: "stripe",
          rawPayload: RAW_PAYLOAD,
        }),
      );
    }
    const otherType = await appendLegacyEvent("probe:event:unrelated", 1, {
      rawPayload: "kept",
    });
    const alreadyClean = await appendLegacyEvent(SUBSCRIPTION_UPDATED_EVENT_QN, 1, {
      providerEventId: "evt_clean",
    });

    await runScrubJob();

    for (const [index, aggregateId] of billing.entries()) {
      expect(await headersOf(aggregateId)).toEqual({
        providerEventId: `evt_${index}`,
        providerName: "stripe",
      });
    }
    expect(await headersOf(otherType)).toEqual({ rawPayload: "kept" });
    expect(await headersOf(alreadyClean)).toEqual({ providerEventId: "evt_clean" });

    await runScrubJob();

    for (const [index, aggregateId] of billing.entries()) {
      expect(await headersOf(aggregateId)).toEqual({
        providerEventId: `evt_${index}`,
        providerName: "stripe",
      });
    }
    expect(await headersOf(otherType)).toEqual({ rawPayload: "kept" });
  });
});
