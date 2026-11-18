// Requests stored before the host gate have no host in their created event; legacyHostOf supplies
// it while the events are replayed, the stored events stay unchanged.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { append, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/index.ts";
import { createRendererPuppeteerClientFeature } from "../../renderer-puppeteer-client/feature.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createTemplateResolverFeature } from "../../template-resolver/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import { signatureRequestTable, signatureSignerTable } from "../entity.ts";
import { createSignatureFeature } from "../feature.ts";
import type { SignatureHost, SignatureLegacyHostResolver } from "../options.ts";
import { SignatureQueries } from "../web/constants.ts";
import { leaseHostFeature, seedLease } from "./lease-host.ts";

const TENANT = testTenantId(11);
const MEMBER = createTestUser({ id: 1, tenantId: TENANT, roles: ["TenantMember"] });
const ADMIN = createTestUser({ id: 2, tenantId: TENANT, roles: ["TenantAdmin"] });
const REQUEST_PROJECTION = "signature:projection:signature-request-entity";
const LEGACY_SUBJECT_TYPE = "leaseContract";

type Subject = Parameters<SignatureLegacyHostResolver>[0];

let stack: TestStack;
let leaseId: string;
let resolverCalls: Subject[] = [];
let resolveHost: (subject: Subject) => SignatureHost | undefined = () => undefined;

const features = [
  createUserFeature(),
  createAuthFoundationFeature(),
  createSessionsFeature(),
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createUserDataRightsFeature(),
  createFilesFeature(),
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createRendererPuppeteerClientFeature(),
  leaseHostFeature,
  createSignatureFeature({
    retention: { keepFor: "10y" },
    linkSecret: "signature-legacy-host-test-link-secret-0123456789",
    hostEntities: ["lease"],
    signaturePageUrl: "https://app.example/sign",
    deliverLink: async () => {},
    legacyHostOf: async (subject) => {
      resolverCalls.push(subject);
      return resolveHost(subject);
    },
  }),
];

beforeAll(async () => {
  stack = await setupTestStack({
    features,
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await createProjectionStateTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    signatureRequestTable,
    signatureSignerTable,
    fileRefsTable,
    eventsTable,
  ]);
  resolverCalls = [];
  resolveHost = () => undefined;
  leaseId = await seedLease(stack.db, TENANT, ADMIN);
});

type RequestEvent = {
  readonly id: string;
  readonly eventVersion: number;
  readonly host?: SignatureHost;
};

async function appendRequestCreated({ id, eventVersion, host }: RequestEvent): Promise<void> {
  await append(stack.db, {
    aggregateId: id,
    aggregateType: "signatureRequest",
    tenantId: TENANT,
    expectedVersion: 0,
    type: "signatureRequest.created",
    eventVersion,
    payload: {
      documentFileId: generateId(),
      documentSha256: "0".repeat(64),
      title: "Rental agreement",
      level: "simple",
      subjectType: LEGACY_SUBJECT_TYPE,
      subjectId: leaseId,
      status: "open",
      expiresAt: "2099-01-01T00:00:00Z",
      ...host,
    },
    metadata: { userId: ADMIN.id, requestId: `legacy:${id}` },
  });
}

async function replay(): Promise<void> {
  await rebuildProjection(REQUEST_PROJECTION, {
    db: stack.db,
    registry: createRegistry(features),
  });
}

async function storedRow(id: string) {
  const rows = await selectMany(stack.db, signatureRequestTable, { id });
  return rows[0];
}

async function visibleIds(): Promise<string[]> {
  const page = await stack.http.queryOk<{ rows: { id: string }[] }>(
    SignatureQueries.list,
    { limit: 200 },
    MEMBER,
  );
  return page.rows.map((row) => row.id);
}

describe("signature :: legacyHostOf", () => {
  test("a request without host gets the host the resolver names and becomes visible", async () => {
    const id = generateId();
    await appendRequestCreated({ id, eventVersion: 1 });
    resolveHost = (subject) =>
      subject.subjectType === LEGACY_SUBJECT_TYPE
        ? { hostType: "lease", hostId: subject.subjectId }
        : undefined;

    await replay();

    const row = await storedRow(id);
    expect(row?.["hostType"]).toBe("lease");
    expect(row?.["hostId"]).toBe(leaseId);
    expect(resolverCalls).toEqual([{ subjectType: LEGACY_SUBJECT_TYPE, subjectId: leaseId }]);
    expect(await visibleIds()).toEqual([id]);
  });

  test("a resolver without an answer leaves the request without host and invisible", async () => {
    const id = generateId();
    await appendRequestCreated({ id, eventVersion: 1 });

    await replay();

    expect(resolverCalls).toHaveLength(1);
    const row = await storedRow(id);
    expect(row).toBeDefined();
    expect(row?.["hostType"] ?? null).toBeNull();
    expect(row?.["hostId"] ?? null).toBeNull();
    expect(await visibleIds()).toEqual([]);
  });

  test("a host type outside hostEntities is ignored like no answer", async () => {
    const id = generateId();
    await appendRequestCreated({ id, eventVersion: 1 });
    resolveHost = (subject) => ({ hostType: "fileRef", hostId: subject.subjectId });

    await replay();

    expect(resolverCalls).toHaveLength(1);
    const row = await storedRow(id);
    expect(row?.["hostType"] ?? null).toBeNull();
    expect(await visibleIds()).toEqual([]);
  });

  test("events that already carry a host never reach the resolver", async () => {
    const host = { hostType: "lease", hostId: leaseId };
    const legacyWithHost = generateId();
    const current = generateId();
    await appendRequestCreated({ id: legacyWithHost, eventVersion: 1, host });
    await appendRequestCreated({ id: current, eventVersion: 2, host });
    resolveHost = () => ({ hostType: "lease", hostId: "other" });

    await replay();

    expect(resolverCalls).toEqual([]);
    expect((await storedRow(legacyWithHost))?.["hostId"]).toBe(leaseId);
    expect((await storedRow(current))?.["hostId"]).toBe(leaseId);
    expect((await visibleIds()).sort()).toEqual([legacyWithHost, current].sort());
  });
});
