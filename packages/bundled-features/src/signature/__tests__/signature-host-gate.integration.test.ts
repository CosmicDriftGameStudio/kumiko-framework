// A request is visible and workable only while its host row is readable through the host entity's
// own `access.read`; everything else answers like a missing record.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { PDFDocument } from "pdf-lib";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import { signatureRequestTable, signatureSignerTable } from "../entity.ts";
import { createSignatureFeature } from "../feature.ts";
import { SIGNATURE_REQUEST_STATUS, SignatureHandlers, SignatureQueries } from "../web/constants.ts";
import { makePng, toBase64 } from "./png-fixture.ts";

const TENANT = testTenantId(9);
const USER_A = createTestUser({
  id: 1,
  tenantId: TENANT,
  roles: ["TenantMember"],
  claims: { team: "team-a" },
});
const USER_B = createTestUser({
  id: 2,
  tenantId: TENANT,
  roles: ["TenantMember"],
  claims: { team: "team-b" },
});
const ADMIN = createTestUser({ id: 3, tenantId: TENANT, roles: ["TenantAdmin"] });
const HOST_TYPE = "lease";
const NOT_FOUND = 404;

const leaseEntity = createEntity({
  name: HOST_TYPE,
  table: "signature_host_gate_leases",
  softDelete: true,
  fields: {
    teamId: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
    name: createTextField({
      required: true,
      maxLength: 100,
      personal: false,
      reason: "technical_reference",
    }),
  },
  access: {
    read: {
      TenantAdmin: "all",
      TenantMember: {
        kind: "where",
        where: (user, ctx) => ({
          sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
          params: [user.claims?.["team"] ?? null],
        }),
      },
    },
  } satisfies NonNullable<EntityDefinition["access"]>,
});

const leaseHostFeature = defineFeature("signature-host-gate-lease", (r) => {
  r.entity(leaseEntity);
});

const leaseExecutor = createEventStoreExecutor(buildEntityTable(leaseEntity), leaseEntity, {
  entityName: HOST_TYPE,
});

const provider = createInMemoryFileProvider();
const deliveredLinks: string[] = [];
let stack: TestStack;
let leaseA: string;
let leaseB: string;

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

function hostDb() {
  return createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "test seeds the host row",
  });
}

async function seedLease(teamId: string): Promise<string> {
  const created = await leaseExecutor.create({ teamId, name: `Lease ${teamId}` }, ADMIN, hostDb());
  if (!created.isSuccess) throw new Error(`lease create failed: ${created.error.message}`);
  return String(created.data.id);
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      createFilesFeature(),
      leaseHostFeature,
      createSignatureFeature({
        retention: { keepFor: "10y", unfinishedKeepFor: "90d" },
        linkSecret: "signature-host-gate-test-link-secret-0123456789",
        hostEntities: [HOST_TYPE],
        renderHtmlToPdf: async () => new Uint8Array(),
        signaturePageUrl: "https://app.example/sign",
        deliverLink: async (_ctx, delivery) => {
          deliveredLinks.push(delivery.signerId);
        },
      }),
    ],
    files: { storageProvider: provider },
  });
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
  deliveredLinks.length = 0;
  leaseA = await seedLease("team-a");
  leaseB = await seedLease("team-b");
});

async function seedDocument(uploader: SessionUser): Promise<string> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const content = await pdf.save();
  const storageKey = `${TENANT}/signature/contract-${crypto.randomUUID()}.pdf`;
  await provider.write(storageKey, content, "application/pdf");
  const created = await fileRefExecutor.create(
    { storageKey, fileName: "contract.pdf", mimeType: "application/pdf", size: content.length },
    uploader,
    hostDb(),
  );
  if (!created.isSuccess) throw new Error(`fileRef create failed: ${created.error.message}`);
  return String(created.data.id);
}

type RequestData = { requestId: string; signerIds: string[] };

async function requestPayload(uploader: SessionUser, hostType: string, hostId: string) {
  return {
    documentFileId: await seedDocument(uploader),
    title: "Rental agreement",
    subjectType: "protocol",
    subjectId: "handover",
    hostType,
    hostId,
    signers: [{ name: "Ada", email: "ada@example.test" }],
  };
}

async function requestOnLeaseA(): Promise<RequestData> {
  return stack.http.writeOk<RequestData>(
    SignatureHandlers.request,
    await requestPayload(USER_A, HOST_TYPE, leaseA),
    USER_A,
  );
}

type RequestRow = { id: string; status: string; hostId: string };
type Page<Row> = { rows: Row[]; nextCursor: string | null; total?: number };

function listRequests(user: SessionUser, payload: object = { limit: 200 }) {
  return stack.http.queryOk<Page<RequestRow>>(SignatureQueries.list, payload, user);
}

async function statusOf(requestId: string): Promise<string | undefined> {
  const row = await stack.http.queryOk<RequestRow | null>(
    SignatureQueries.detail,
    { id: requestId },
    ADMIN,
  );
  return row?.status;
}

describe("signature :: host gate on request", () => {
  test("a request needs a readable host of an allowed type and creates nothing otherwise", async () => {
    const created = await stack.http.writeOk<RequestData>(
      SignatureHandlers.request,
      await requestPayload(USER_A, HOST_TYPE, leaseA),
      USER_A,
    );
    expect(created.requestId).toBeTruthy();

    const refusals = [
      { hostType: HOST_TYPE, hostId: leaseB },
      { hostType: "fileRef", hostId: leaseA },
      { hostType: "contract", hostId: leaseA },
    ];
    for (const { hostType, hostId } of refusals) {
      const failure = await stack.http.writeErr(
        SignatureHandlers.request,
        await requestPayload(USER_A, hostType, hostId),
        USER_A,
      );
      expect(failure.httpStatus).toBe(NOT_FOUND);
    }
    const onB = await listRequests(ADMIN, {
      filters: [{ field: "hostId", op: "eq", value: leaseB }],
      limit: 200,
    });
    expect(onB.rows).toEqual([]);
  });
});

describe("signature :: host gate on queries", () => {
  test("the list shows each user the requests of the hosts they can read, with a matching total", async () => {
    const ownA = await Promise.all([requestOnLeaseA(), requestOnLeaseA()]);
    const onB = await stack.http.writeOk<RequestData>(
      SignatureHandlers.request,
      await requestPayload(ADMIN, HOST_TYPE, leaseB),
      ADMIN,
    );
    const idsOfA = ownA.map((request) => request.requestId).sort();

    const forA = await listRequests(USER_A, { totalCount: true, limit: 200 });
    expect(forA.rows.map((row) => row.id).sort()).toEqual(idsOfA);
    expect(forA.total).toBe(forA.rows.length);

    const forB = await listRequests(USER_B, { totalCount: true, limit: 200 });
    expect(forB.rows.map((row) => row.id)).toEqual([onB.requestId]);
    expect(forB.total).toBe(1);

    const forAdmin = await listRequests(ADMIN, { totalCount: true, limit: 200 });
    expect(forAdmin.rows.map((row) => row.id).sort()).toEqual(
      [...idsOfA, onB.requestId].sort(),
    );
    expect(forAdmin.total).toBe(3);
  });

  test("an offset pages through the visible requests of a user", async () => {
    await Promise.all([requestOnLeaseA(), requestOnLeaseA()]);
    const page = await listRequests(USER_A, { offset: 1, limit: 200, totalCount: true });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  test("detail answers null for a user without the host and the row for the one with it", async () => {
    const { requestId } = await requestOnLeaseA();
    expect(await stack.http.queryOk(SignatureQueries.detail, { id: requestId }, USER_B)).toBeNull();
    const row = await stack.http.queryOk<RequestRow>(
      SignatureQueries.detail,
      { id: requestId },
      USER_A,
    );
    expect(row.id).toBe(requestId);
  });
});

describe("signature :: host gate on handlers", () => {
  test("sign-in-person, issue-link, revoke-link and cancel answer not found and change nothing", async () => {
    const { requestId, signerIds } = await requestOnLeaseA();
    const signerId = signerIds[0];
    const attempts = [
      [SignatureHandlers.signInPerson, { signerId, imagePngBase64: toBase64(makePng()) }],
      [SignatureHandlers.issueLink, { signerId }],
      [SignatureHandlers.revokeLink, { signerId }],
      [SignatureHandlers.cancel, { requestId }],
    ] as const;
    for (const [handler, payload] of attempts) {
      const failure = await stack.http.writeErr(handler, payload, USER_B);
      expect(failure.httpStatus).toBe(NOT_FOUND);
    }
    expect(await statusOf(requestId)).toBe(SIGNATURE_REQUEST_STATUS.Open);
    expect(deliveredLinks).toEqual([]);
  });

  test("the user who can read the host issues a link", async () => {
    const { signerIds } = await requestOnLeaseA();
    const signerId = signerIds[0];
    if (signerId === undefined) throw new Error("request created no signer");
    await stack.http.writeOk(SignatureHandlers.issueLink, { signerId }, USER_A);
    expect(deliveredLinks).toEqual([signerId]);
  });

  test("a DPO without host read cannot forget a signer", async () => {
    const dpo = createTestUser({ id: 4, tenantId: TENANT, roles: ["DataProtectionOfficer"] });
    const { requestId, signerIds } = await requestOnLeaseA();
    const signerId = signerIds[0];
    if (signerId === undefined) throw new Error("request created no signer");

    const failure = await stack.http.writeErr(SignatureHandlers.forgetSigner, { signerId }, dpo);

    expect(failure.httpStatus).toBe(NOT_FOUND);
    const signers = await stack.http.queryOk<Page<{ id: string }>>(
      SignatureQueries.signerList,
      { filters: [{ field: "requestId", op: "eq", value: requestId }] },
      USER_A,
    );
    expect(signers.rows).toHaveLength(1);
    expect(await statusOf(requestId)).toBe(SIGNATURE_REQUEST_STATUS.Open);
  });

  test("a file the caller cannot read is refused like an unknown file", async () => {
    const failure = await stack.http.writeErr(
      SignatureHandlers.request,
      await requestPayload(USER_A, HOST_TYPE, leaseA),
      ADMIN,
    );
    expect(failure.httpStatus).toBe(422);
    expect(JSON.stringify(failure)).toContain("document_not_a_pdf");
  });
});

describe("signature :: signer list", () => {
  test("it needs exactly one requestId filter for every user", async () => {
    await requestOnLeaseA();
    for (const user of [USER_A, ADMIN]) {
      const refused = await stack.http.queryErr(SignatureQueries.signerList, {}, user);
      expect(refused.httpStatus).toBe(403);
    }
  });

  test("it shows the signers of a request to the user who can read its host only", async () => {
    const { requestId } = await requestOnLeaseA();
    const payload = { filters: [{ field: "requestId", op: "eq", value: requestId }] };
    const forA = await stack.http.queryOk<Page<{ id: string }>>(
      SignatureQueries.signerList,
      payload,
      USER_A,
    );
    expect(forA.rows).toHaveLength(1);
    const forB = await stack.http.queryOk<Page<{ id: string }>>(
      SignatureQueries.signerList,
      payload,
      USER_B,
    );
    expect(forB.rows).toEqual([]);
  });

  test("a requestId that is no uuid answers an empty page, not a server error", async () => {
    const page = await stack.http.queryOk<Page<{ id: string }>>(
      SignatureQueries.signerList,
      { filters: [{ field: "requestId", op: "eq", value: "not-a-uuid" }] },
      USER_B,
    );
    expect(page.rows).toEqual([]);
  });
});

describe("signature :: host changes", () => {
  test("a soft-deleted host hides its requests", async () => {
    const { requestId } = await requestOnLeaseA();
    expect((await listRequests(USER_A)).rows.map((row) => row.id)).toContain(requestId);
    const deleted = await leaseExecutor.delete({ id: leaseA }, ADMIN, hostDb());
    expect(deleted.isSuccess).toBe(true);
    expect((await listRequests(USER_A)).rows).toEqual([]);
  });

  test("a host moved to another team hides its requests from the old team", async () => {
    const { requestId } = await requestOnLeaseA();
    const moved = await leaseExecutor.update(
      { id: leaseA, changes: { teamId: "team-b" } },
      ADMIN,
      hostDb(),
      { skipOptimisticLock: true },
    );
    expect(moved.isSuccess).toBe(true);
    expect((await listRequests(USER_A)).rows).toEqual([]);
    expect((await listRequests(USER_B)).rows.map((row) => row.id)).toEqual([requestId]);
  });
});
