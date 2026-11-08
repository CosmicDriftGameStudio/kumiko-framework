// `authorizeSubject` limits requests to the subjects a user may see; `unscopedRoles` skip the check.
// A request file the caller cannot open through GET /files/:id is refused with or without the hook.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { MAX_LIST_LIMIT, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { PDFDocument } from "pdf-lib";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import { createSignatureFeature } from "../feature.ts";
import { SIGNATURE_REQUEST_STATUS, SignatureHandlers, SignatureQueries } from "../web/constants.ts";
import { makePng, toBase64 } from "./png-fixture.ts";

const TENANT = testTenantId(9);
const USER_A = createTestUser({ id: 1, tenantId: TENANT, roles: ["TenantMember"] });
const USER_B = createTestUser({ id: 2, tenantId: TENANT, roles: ["TenantMember"] });
const ADMIN = createTestUser({ id: 3, tenantId: TENANT, roles: ["TenantAdmin"] });
const SUBJECT_TYPE = "lease";
const SUBJECT_A = "subject-a";
const NOT_FOUND = 404;

const provider = createInMemoryFileProvider();
const deliveredLinks: string[] = [];
let stack: TestStack;

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

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
      createSignatureFeature({
        retention: { keepFor: "10y" },
        linkSecret: "signature-subject-test-link-secret-0123456789",
        renderHtmlToPdf: async () => new Uint8Array(),
        signaturePageUrl: "https://app.example/sign",
        deliverLink: async (_ctx, delivery) => {
          deliveredLinks.push(delivery.signerId);
        },
        authorizeSubject: async (_ctx, user, subject) =>
          user.id === USER_A.id && subject.subjectId === SUBJECT_A,
        unscopedRoles: ["TenantAdmin"],
      }),
    ],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  deliveredLinks.length = 0;
});

async function seedDocument(uploader: SessionUser): Promise<string> {
  const db = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "test seeds the document the signature request refers to",
  });
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const content = await pdf.save();
  const storageKey = `${TENANT}/signature/contract-${crypto.randomUUID()}.pdf`;
  await provider.write(storageKey, content, "application/pdf");
  const created = await fileRefExecutor.create(
    { storageKey, fileName: "contract.pdf", mimeType: "application/pdf", size: content.length },
    uploader,
    db,
  );
  if (!created.isSuccess) throw new Error(`fileRef create failed: ${created.error.message}`);
  return String(created.data.id);
}

type RequestData = { requestId: string; signerIds: string[] };

async function requestPayload(uploader: SessionUser, subjectId: string) {
  return {
    documentFileId: await seedDocument(uploader),
    title: "Rental agreement",
    subjectType: SUBJECT_TYPE,
    subjectId,
    signers: [{ name: "Ada", email: "ada@example.test" }],
  };
}

function createRequestOfA(): Promise<RequestData> {
  return requestPayload(USER_A, SUBJECT_A).then((payload) =>
    stack.http.writeOk<RequestData>(SignatureHandlers.request, payload, USER_A),
  );
}

type RequestRow = { id: string; status: string; subjectId: string };
type Page<Row> = { rows: Row[]; nextCursor: string | null };

function listRequests(user: SessionUser, filters: readonly object[]) {
  return stack.http.queryOk<Page<RequestRow>>(SignatureQueries.list, { filters }, user);
}

const subjectFilters = (subjectId: string) => [
  { field: "subjectType", op: "eq", value: SUBJECT_TYPE },
  { field: "subjectId", op: "eq", value: subjectId },
];

async function statusOf(requestId: string): Promise<string | undefined> {
  const row = await stack.http.queryOk<RequestRow | null>(
    SignatureQueries.detail,
    { id: requestId },
    ADMIN,
  );
  return row?.status;
}

describe("signature :: authorizeSubject on handlers", () => {
  test("a request on a foreign subject is refused and creates nothing", async () => {
    const before = (await listRequests(ADMIN, [])).rows.length;
    const failure = await stack.http.writeErr(
      SignatureHandlers.request,
      await requestPayload(USER_B, SUBJECT_A),
      USER_B,
    );
    expect(failure.httpStatus).toBe(NOT_FOUND);
    expect((await listRequests(ADMIN, [])).rows.length).toBe(before);
  });

  test("a request on an allowed subject succeeds", async () => {
    const created = await createRequestOfA();
    expect(created.requestId).toBeTruthy();
  });

  test("cancel by a user without the subject answers not found and leaves the request open", async () => {
    const { requestId } = await createRequestOfA();
    const failure = await stack.http.writeErr(SignatureHandlers.cancel, { requestId }, USER_B);
    expect(failure.httpStatus).toBe(NOT_FOUND);
    expect(await statusOf(requestId)).toBe(SIGNATURE_REQUEST_STATUS.Open);
  });

  test("issue-link by a user without the subject answers not found and delivers nothing", async () => {
    const { signerIds } = await createRequestOfA();
    const failure = await stack.http.writeErr(
      SignatureHandlers.issueLink,
      { signerId: signerIds[0] },
      USER_B,
    );
    expect(failure.httpStatus).toBe(NOT_FOUND);
    expect(deliveredLinks).toEqual([]);
  });

  test("issue-link by the allowed user delivers the link", async () => {
    const { signerIds } = await createRequestOfA();
    const signerId = signerIds[0];
    if (signerId === undefined) throw new Error("request created no signer");
    await stack.http.writeOk(SignatureHandlers.issueLink, { signerId }, USER_A);
    expect(deliveredLinks).toEqual([signerId]);
  });

  test("revoke-link by a user without the subject answers not found", async () => {
    const { signerIds } = await createRequestOfA();
    const failure = await stack.http.writeErr(
      SignatureHandlers.revokeLink,
      { signerId: signerIds[0] },
      USER_B,
    );
    expect(failure.httpStatus).toBe(NOT_FOUND);
  });

  test("sign-in-person by a user without the subject answers not found and leaves the request open", async () => {
    const { requestId, signerIds } = await createRequestOfA();
    const failure = await stack.http.writeErr(
      SignatureHandlers.signInPerson,
      { signerId: signerIds[0], imagePngBase64: toBase64(makePng()) },
      USER_B,
    );
    expect(failure.httpStatus).toBe(NOT_FOUND);
    expect(await statusOf(requestId)).toBe(SIGNATURE_REQUEST_STATUS.Open);
  });
});

describe("signature :: authorizeSubject on queries", () => {
  test("detail answers null for a user without the subject and the row for the allowed one", async () => {
    const { requestId } = await createRequestOfA();
    expect(await stack.http.queryOk(SignatureQueries.detail, { id: requestId }, USER_B)).toBeNull();
    const row = await stack.http.queryOk<RequestRow>(
      SignatureQueries.detail,
      { id: requestId },
      USER_A,
    );
    expect(row.id).toBe(requestId);
  });

  test("list without a subject filter is forbidden for a scoped user", async () => {
    const failure = await stack.http.queryErr(SignatureQueries.list, {}, USER_B);
    expect(failure.httpStatus).toBe(403);
  });

  test("list with a subject filter shows nothing to B and the row to A", async () => {
    const { requestId } = await createRequestOfA();
    expect((await listRequests(USER_B, subjectFilters(SUBJECT_A))).rows).toEqual([]);
    const forA = await listRequests(USER_A, subjectFilters(SUBJECT_A));
    expect(forA.rows.map((row) => row.id)).toContain(requestId);
  });

  test("list with an in-filter keeps only the allowed subjects", async () => {
    const { requestId } = await createRequestOfA();
    const mixed = await listRequests(USER_A, [
      { field: "subjectType", op: "eq", value: SUBJECT_TYPE },
      { field: "subjectId", op: "in", value: [SUBJECT_A, "subject-other"] },
    ]);
    expect(mixed.rows.map((row) => row.id)).toContain(requestId);
    expect(mixed.rows.every((row) => row.subjectId === SUBJECT_A)).toBe(true);
  });

  test("an in-filter longer than the list limit is forbidden", async () => {
    const tooMany = Array.from({ length: MAX_LIST_LIMIT + 1 }, (_, index) => `subject-${index}`);
    const failure = await stack.http.queryErr(
      SignatureQueries.list,
      {
        filters: [
          { field: "subjectType", op: "eq", value: SUBJECT_TYPE },
          { field: "subjectId", op: "in", value: tooMany },
        ],
      },
      USER_A,
    );
    expect(failure.httpStatus).toBe(403);
  });

  test("an unscoped role lists without a filter", async () => {
    const { requestId } = await createRequestOfA();
    const all = await listRequests(ADMIN, []);
    expect(all.rows.map((row) => row.id)).toContain(requestId);
  });

  test("signer list needs a requestId filter and answers empty for a foreign request", async () => {
    const { requestId } = await createRequestOfA();
    const forbidden = await stack.http.queryErr(SignatureQueries.signerList, {}, USER_B);
    expect(forbidden.httpStatus).toBe(403);
    const requestFilter = { filters: [{ field: "requestId", op: "eq", value: requestId }] };
    const forB = await stack.http.queryOk<Page<{ id: string }>>(
      SignatureQueries.signerList,
      requestFilter,
      USER_B,
    );
    expect(forB.rows).toEqual([]);
    const forA = await stack.http.queryOk<Page<{ id: string }>>(
      SignatureQueries.signerList,
      requestFilter,
      USER_A,
    );
    expect(forA.rows).toHaveLength(1);
  });
});

describe("signature :: request file check", () => {
  test("a file the caller cannot read is refused like an unknown file", async () => {
    const failure = await stack.http.writeErr(
      SignatureHandlers.request,
      await requestPayload(USER_A, SUBJECT_A),
      ADMIN,
    );
    expect(failure.httpStatus).toBe(422);
    expect(JSON.stringify(failure)).toContain("document_not_a_pdf");
  });
});
