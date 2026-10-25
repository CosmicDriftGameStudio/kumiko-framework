// The mail and storage probes against the in-memory providers; a failing plugin under the same
// extension turns each probe red. Also pins that a run with these probes writes events only on the run.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature, EXT_FILE_PROVIDER } from "@cosmicdrift/kumiko-framework/engine";
import { createInMemoryFileProvider } from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import { type TestStack, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { createFileFoundationFeature } from "../../file-foundation/index.ts";
import { createFileProviderInMemoryFeature, listKeys } from "../../file-provider-inmemory/index.ts";
import {
  createMailFoundationFeature,
  MAIL_TRANSPORT_EXTENSION,
} from "../../mail-foundation/index.ts";
import {
  createMailTransportInMemoryFeature,
  getInbox,
} from "../../mail-transport-inmemory/index.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { ProbeTextKeys, ReadinessQueries, ReadinessWrites } from "../constants.ts";
import { markEvents, setupReadinessStack } from "./readiness-test-stack.ts";

const MAIL_PROBE = "mail-foundation:probe:send-test-mail";
const FILES_PROBE = "file-foundation:probe:storage-roundtrip";
const MAIL_PROVIDER_KEY = "mail-foundation:config:provider";
const FILE_PROVIDER_KEY = "file-foundation:config:provider";

const failingMail = defineFeature("probe-failing-mail", (r) => {
  r.requires({ features: ["mail-foundation"] });
  r.useExtension(MAIL_TRANSPORT_EXTENSION, "failing", {
    selectableInSettings: false,
    build: async () => ({
      send: async () => {
        throw new Error("smtp relay down");
      },
    }),
  });
});

const failingFiles = defineFeature("probe-failing-files", (r) => {
  r.requires({ features: ["file-foundation"] });
  r.useExtension(EXT_FILE_PROVIDER, "failing", {
    build: async () => ({
      ...createInMemoryFileProvider(),
      write: async () => {
        throw new Error("disk full");
      },
    }),
  });
});

type Row = {
  probe: string;
  status: string;
  message: { i18nKey: string };
  label: { i18nKey: string };
};

let stack: TestStack;
let nextTenant = 900;

beforeAll(async () => {
  stack = await setupReadinessStack({
    features: [
      createUserFeature(),
      createMailFoundationFeature(),
      createMailTransportInMemoryFeature(),
      failingMail,
      createFileFoundationFeature(),
      createFileProviderInMemoryFeature(),
      failingFiles,
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function freshAdmin(email: string | undefined) {
  nextTenant += 1;
  const admin = createTestUser({
    id: nextTenant,
    tenantId: testTenantId(nextTenant),
    roles: ["TenantAdmin"],
  });
  if (email !== undefined) {
    await seedRowViaEventStore(stack.db, userTable, {
      id: admin.id,
      email,
      passwordHash: "hashed",
      displayName: "Probe Admin",
      locale: "en",
      emailVerified: true,
      roles: '["TenantAdmin"]',
      status: USER_STATUS.Active,
    });
  }
  return admin;
}

async function select(admin: Awaited<ReturnType<typeof freshAdmin>>, key: string, value: string) {
  await stack.http.writeOk("config:write:set", { key, value }, admin);
}

async function resultsOf(admin: Awaited<ReturnType<typeof freshAdmin>>): Promise<Row[]> {
  await stack.http.writeOk(ReadinessWrites.runProbes, {}, admin);
  await stack.drainJobs();
  return (await stack.http.queryOk<{ rows: Row[] }>(ReadinessQueries.latestResults, {}, admin))
    .rows;
}

const find = (rows: Row[], probe: string) => rows.find((row) => row.probe === probe);

describe("mail probe", () => {
  test("sends the test mail to the starter and stores no address", async () => {
    const admin = await freshAdmin("starter@probe.example");
    await select(admin, MAIL_PROVIDER_KEY, "inmemory");

    const rows = await resultsOf(admin);

    expect(find(rows, MAIL_PROBE)?.status).toBe("ok");
    expect(getInbox(admin.tenantId).map((mail) => mail.to)).toEqual(["starter@probe.example"]);
    expect(JSON.stringify(rows)).not.toContain("starter@probe.example");
  });

  test("a transport that throws makes the probe fail with the generic text", async () => {
    const admin = await freshAdmin("starter2@probe.example");
    await select(admin, MAIL_PROVIDER_KEY, "failing");

    const row = find(await resultsOf(admin), MAIL_PROBE);

    expect(row?.status).toBe("failed");
    expect(row?.message.i18nKey).toBe(ProbeTextKeys.failed);
  });

  test("a tenant without its own provider is skipped as not configured", async () => {
    const admin = await freshAdmin("starter3@probe.example");

    const row = find(await resultsOf(admin), MAIL_PROBE);

    expect(row?.status).toBe("skipped");
    expect(row?.message.i18nKey).toBe("mail-foundation.probe.not-configured");
  });

  test("a starter without a known address is skipped", async () => {
    const admin = await freshAdmin(undefined);
    await select(admin, MAIL_PROVIDER_KEY, "inmemory");

    const row = find(await resultsOf(admin), MAIL_PROBE);

    expect(row?.status).toBe("skipped");
    expect(row?.message.i18nKey).toBe("mail-foundation.probe.no-recipient");
  });
});

describe("storage probe", () => {
  test("writes, reads and deletes the test file without leaving a key or file events", async () => {
    const admin = await freshAdmin(undefined);
    await select(admin, FILE_PROVIDER_KEY, "inmemory");
    const newEvents = await markEvents(stack);

    const started = await stack.http.writeOk<{ runId: string }>(
      ReadinessWrites.runProbes,
      {},
      admin,
    );
    await stack.drainJobs();
    const rows = (
      await stack.http.queryOk<{ rows: Row[] }>(ReadinessQueries.latestResults, {}, admin)
    ).rows;

    expect(find(rows, FILES_PROBE)?.status).toBe("ok");
    expect(listKeys(admin.tenantId)).toEqual([]);
    const runEvents = await newEvents();
    expect(runEvents.every((event) => event.aggregateId === started.runId)).toBe(true);
  });

  test("a provider that throws fails the probe", async () => {
    const admin = await freshAdmin(undefined);
    await select(admin, FILE_PROVIDER_KEY, "failing");

    const row = find(await resultsOf(admin), FILES_PROBE);

    expect(row?.status).toBe("failed");
    expect(row?.message.i18nKey).toBe(ProbeTextKeys.failed);
  });

  test("a tenant without a provider is skipped as not configured", async () => {
    const admin = await freshAdmin(undefined);

    const row = find(await resultsOf(admin), FILES_PROBE);

    expect(row?.status).toBe("skipped");
    expect(row?.message.i18nKey).toBe("file-foundation.probe.not-configured");
  });
});
