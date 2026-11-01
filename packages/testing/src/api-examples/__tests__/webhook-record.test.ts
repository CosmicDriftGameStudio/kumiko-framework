import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebhookEventContract } from "@cosmicdrift/kumiko-types/feature";
import * as z from "zod";
import { EXAMPLE_TIMESTAMP } from "../normalize.ts";
import { RECORD_API_EXAMPLES_ENV } from "../record.ts";
import { recordWebhookExample } from "../webhook-record.ts";

const contract: WebhookEventContract = {
  qn: "helpdesk:ticket-closed",
  description: "A ticket was closed.",
  payload: z.object({ id: z.uuid(), resolution: z.string(), closedAt: z.string() }),
  version: 3,
  origin: "declared",
};

const REAL_ID = "5b0f4e0e-6f43-4f3a-bf0e-3f1f1b6f7d11";

let dir: string;
let previousFlag: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "webhook-record-"));
  previousFlag = process.env[RECORD_API_EXAMPLES_ENV];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (previousFlag === undefined) delete process.env[RECORD_API_EXAMPLES_ENV];
  else process.env[RECORD_API_EXAMPLES_ENV] = previousFlag;
});

const record = (payload: unknown) =>
  recordWebhookExample({ name: "ticket-closed", dir, contract, payload });

describe("recordWebhookExample", () => {
  test("returns the parsed payload and writes nothing without the record flag", async () => {
    delete process.env[RECORD_API_EXAMPLES_ENV];
    const payload = await record({
      id: REAL_ID,
      resolution: "fixed",
      closedAt: "2026-03-02T10:11:12.000Z",
      extra: "dropped",
    });
    expect(payload).toEqual({
      id: REAL_ID,
      resolution: "fixed",
      closedAt: "2026-03-02T10:11:12.000Z",
    });
    expect(existsSync(join(dir, "webhooks"))).toBe(false);
  });

  test("with the flag it writes a normalized webhooks/<name>.json", async () => {
    process.env[RECORD_API_EXAMPLES_ENV] = "1";
    await record({ id: REAL_ID, resolution: "fixed", closedAt: "2026-03-02T10:11:12.000Z" });
    const file: unknown = JSON.parse(
      readFileSync(join(dir, "webhooks", "ticket-closed.json"), "utf8"),
    );
    expect(file).toEqual({
      event: "helpdesk:ticket-closed",
      version: 3,
      payload: {
        id: "00000000-0000-4000-8000-000000000001",
        resolution: "fixed",
        closedAt: EXAMPLE_TIMESTAMP,
      },
    });
  });

  test("a payload that contradicts the contract throws with the issues and writes nothing", async () => {
    process.env[RECORD_API_EXAMPLES_ENV] = "1";
    await expect(record({ id: "nope", resolution: "fixed" })).rejects.toThrow(
      /helpdesk:ticket-closed.*id:.*closedAt:/s,
    );
    expect(existsSync(join(dir, "webhooks"))).toBe(false);
  });
});
