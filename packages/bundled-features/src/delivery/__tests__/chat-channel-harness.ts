// Shared integration harness for the chat channels (slack/discord/teams/telegram):
// a real test stack with the real secrets write path, a local HTTP stub standing in
// for the provider, and the real delivery.send job handler. Not a test file.

import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createSystemDbView, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition, JobContext } from "@cosmicdrift/kumiko-framework/engine";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  createEnvMasterKeyProvider,
  type SecretsContext,
} from "@cosmicdrift/kumiko-framework/secrets";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config/feature.js";
import { configValuesTable } from "../../config/table.js";
import { createSecretsFeature } from "../../secrets/feature.js";
import { createSecretsContext } from "../../secrets/secrets-context.js";
import { tenantSecretsTable } from "../../secrets/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { DeliveryJobs } from "../constants.js";
import { collectChannels, createDeliveryService } from "../delivery-service.js";
import { createDeliveryFeature } from "../feature.js";
import { deliverySendJob } from "../jobs.js";
import { deliveryAttemptsTable } from "../tables.js";

export type StubRequest = {
  readonly path: string;
  readonly headers: Headers;
  readonly bodyText: string;
  readonly bodyJson: unknown;
};

export type ProviderStub = {
  readonly origin: string;
  readonly requests: StubRequest[];
  hitsOn(pathPrefix: string): StubRequest[];
  stop(): void;
};

// 127.0.0.1 on an ephemeral port. A path containing REDIRECT302 answers 302 to
// /never-hit, FAIL500 answers 500, HANG never answers, anything else 200. Markers
// instead of fixed paths because the Telegram path embeds the bot token.
export function startProviderStub(): ProviderStub {
  const requests: StubRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const bodyText = await req.text();
      let bodyJson: unknown;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }
      requests.push({ path: url.pathname, headers: req.headers, bodyText, bodyJson });
      if (url.pathname.includes("REDIRECT302")) {
        return new Response(null, {
          status: 302,
          // Other hostname on purpose: egress(internal) refuses a cross-host hop, a
          // same-host Location would be followed and make the target "hit".
          headers: { location: `http://localhost:${url.port}/never-hit` },
        });
      }
      if (url.pathname.includes("FAIL500")) return new Response("boom", { status: 500 });
      if (url.pathname.includes("HANG")) return new Promise<Response>(() => undefined);
      return new Response("ok");
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    requests,
    hitsOn: (pathPrefix) => requests.filter((r) => r.path.startsWith(pathPrefix)),
    stop: () => {
      server.stop(true);
    },
  };
}

export type AttemptRow = {
  readonly status: string;
  readonly error: string | null;
  readonly recipientAddress: string | null;
};

export type ChatHarness = {
  readonly stack: TestStack;
  readonly secrets: SecretsContext;
  buildJobContext(jobRunner?: unknown): JobContext;
  readonly attemptRows: AttemptRow[];
  setSecret(key: string, value: string): Promise<void>;
  // Notifies via route, runs the dispatched delivery.send job, returns the attempt row.
  send(
    channel: string,
    address: string,
    data: { title: string; body?: string },
  ): Promise<AttemptRow>;
  cleanup(): Promise<void>;
};

export const tenantAdmin = createTestUser({ roles: ["TenantAdmin"] });

let notificationCounter = 0;

export async function setupChatHarness(channelFeature: FeatureDefinition): Promise<ChatHarness> {
  // The PII subject KMS is process-global and CI runs every integration file
  // in one process: a KMS left configured by an earlier file would encrypt
  // recipientAddress here, and these tests assert on the plaintext row.
  resetPiiSubjectKmsForTests();
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      channelFeature,
    ],
    masterKeyProvider,
    extraContext: ({ db }) => ({
      secrets: createSecretsContext({ db, masterKeyProvider }),
    }),
  });
  const { db } = stack;
  await unsafePushTables(db, {
    configValuesTable,
    tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
  });
  await unsafeCreateEntityTable(db, tenantEntity, "tenant");
  const secrets = createSecretsContext({ db, masterKeyProvider });
  const attemptRows: AttemptRow[] = [];

  // Mirrors what job-runner.ts builds for a systemScope()'d job.
  function buildJobContext(jobRunner?: unknown): JobContext {
    return {
      db,
      registry: stack.registry,
      secrets,
      ...(jobRunner !== undefined && { jobRunner }),
      systemDb: createSystemDbView(
        createTenantDb(db, tenantAdmin.tenantId, "system", undefined, undefined, undefined, {
          unsafeRaw: { reason: "test: job context mirrors systemScope() grant" },
        }),
      ),
    } as unknown as JobContext; // @cast-boundary test-seam — fields the delivery jobs read
  }

  return {
    stack,
    secrets,
    buildJobContext,
    attemptRows,
    async setSecret(key, value) {
      await stack.http.writeOk("secrets:write:set", { key, value }, tenantAdmin);
    },
    async send(channel, address, data) {
      const dispatched: Array<{ name: string; payload: Record<string, unknown> }> = [];
      const runner = {
        async dispatch(name: string, payload?: Record<string, unknown>) {
          dispatched.push({ name, payload: payload ?? {} });
          return "stub-job-id";
        },
      } as unknown as JobRunner; // @cast-boundary test-seam — only dispatch() is used by the service
      const service = createDeliveryService({
        db,
        registry: stack.registry,
        channels: collectChannels(stack.registry),
        jobRunner: runner,
      });
      const notificationType = `app:notify:chat-${notificationCounter++}`;
      await service.notify(
        notificationType,
        { route: { [channel]: address }, data },
        tenantAdmin,
        tenantAdmin.tenantId,
      );
      const sendJob = dispatched.find((d) => d.name === DeliveryJobs.send);
      if (!sendJob) throw new Error("delivery.send was not dispatched");

      const jobContext = buildJobContext();
      await deliverySendJob(sendJob.payload, jobContext);

      const rows = await selectMany<AttemptRow>(db, deliveryAttemptsTable, { notificationType });
      expect(rows).toHaveLength(1);
      const [row] = rows;
      if (!row) throw new Error("no delivery attempt row");
      attemptRows.push(row);
      return row;
    },
    cleanup: () => stack.cleanup(),
  };
}

// Logs captured per test; afterEach asserts none of the forbidden strings
// (webhook URL, bot token) appear anywhere.
export function captureLogsAndForbid(forbidden: () => readonly string[]): void {
  const lines: string[] = [];
  let spies: Array<{ mockRestore(): void }> = [];

  beforeEach(() => {
    lines.length = 0;
    const record = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      spyOn(console, level).mockImplementation(record),
    );
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    const output = lines.join("\n");
    for (const secret of forbidden()) expect(output).not.toContain(secret);
  });
}

export function serializeAttemptRows(rows: readonly AttemptRow[]): string {
  return JSON.stringify(rows);
}

export type FailureCaseContext = {
  readonly harness: ChatHarness;
  readonly stub: ProviderStub;
  readonly channel: string;
  // Seeds the credential that makes `connection` resolve to `url` / the stub path.
  seedConnection(connection: string, urlOrPath: string): Promise<void>;
  // Absolute URL on the stub for a path.
  urlFor(path: string): string;
};

const MESSAGE = { title: "Failure case", body: "body" };

// Failure paths shared by the three webhook-URL providers. Registers tests; call
// inside a describe() whose beforeAll builds the context.
export function registerWebhookFailureCases(getContext: () => FailureCaseContext): void {
  test("stub answers 500 -> failed http_500, connection name as address", async () => {
    const { harness, stub, channel, seedConnection, urlFor } = getContext();
    await seedConnection("failing", urlFor("/api/webhooks/1/FAIL500"));
    const row = await harness.send(channel, "failing", MESSAGE);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("http_500");
    expect(row.recipientAddress).toBe("failing");
    expect(stub.hitsOn("/api/webhooks/1/FAIL500")).toHaveLength(1);
  });

  test("stub answers 302 -> failed redirect_blocked, redirect target never hit", async () => {
    const { harness, stub, channel, seedConnection, urlFor } = getContext();
    await seedConnection("redirecting", urlFor("/api/webhooks/1/REDIRECT302"));
    const row = await harness.send(channel, "redirecting", MESSAGE);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("redirect_blocked");
    expect(stub.hitsOn("/never-hit")).toHaveLength(0);
  });

  test("host outside the allowlist -> failed host_not_allowed, no request", async () => {
    const { harness, stub, channel, seedConnection, urlFor } = getContext();
    // "localhost" resolves to the stub but is not the allowlisted "127.0.0.1".
    await seedConnection(
      "elsewhere",
      urlFor("/api/webhooks/1/blocked").replace("127.0.0.1", "localhost"),
    );
    const row = await harness.send(channel, "elsewhere", MESSAGE);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("host_not_allowed");
    expect(stub.hitsOn("/api/webhooks/1/blocked")).toHaveLength(0);
  });

  test("no secret stored for the connection -> failed missing_credentials", async () => {
    const { harness, channel } = getContext();
    const row = await harness.send(channel, "never-configured", MESSAGE);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("missing_credentials");
    expect(row.recipientAddress).toBe("never-configured");
  });

  test("connection name that is not a slug -> failed invalid_address, no secret read", async () => {
    const { harness, channel } = getContext();
    const row = await harness.send(channel, "../Evil Name", MESSAGE);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("invalid_address");
  });

  test("stub never answers -> failed timeout (feature timeoutMs)", async () => {
    const { harness, channel, seedConnection, urlFor } = getContext();
    await seedConnection("hanging", urlFor("/api/webhooks/1/HANG"));
    const row = await harness.send(channel, "hanging", MESSAGE);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("timeout");
  });
}
