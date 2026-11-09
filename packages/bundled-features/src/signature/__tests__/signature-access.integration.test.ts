// The `access` option replaces the default roles on the signed-in handlers: an app that never
// hands out TenantMember mounts the feature with its own role.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
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
import { SignatureHandlers, SignatureQueries } from "../web/constants.ts";

const TENANT = testTenantId(8);
const CUSTOM_ROLE_USER = createTestUser({ id: 1, tenantId: TENANT, roles: ["CustomRole"] });
const MEMBER_USER = createTestUser({ id: 2, tenantId: TENANT, roles: ["TenantMember"] });

const provider = createInMemoryFileProvider();
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
        linkSecret: "signature-access-test-link-secret-0123456789",
        renderHtmlToPdf: async () => new Uint8Array(),
        signaturePageUrl: "https://app.example/sign",
        deliverLink: async () => {},
        access: { roles: ["CustomRole"] },
      }),
    ],
    files: { storageProvider: provider },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

async function seedDocument(): Promise<string> {
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
    {
      storageKey,
      fileName: "contract.pdf",
      mimeType: "application/pdf",
      size: content.length,
    },
    CUSTOM_ROLE_USER,
    db,
  );
  if (!created.isSuccess) throw new Error(`fileRef create failed: ${created.error.message}`);
  return String(created.data.id);
}

async function requestPayload() {
  return {
    documentFileId: await seedDocument(),
    title: "Rental agreement",
    subjectType: "lease",
    subjectId: "lease-1",
    signers: [{ name: "Ada", email: "ada@example.test" }],
  };
}

describe("signature :: access option", () => {
  test("a user holding only the configured role can create a request", async () => {
    const created = await stack.http.writeOk<{ requestId: string }>(
      SignatureHandlers.request,
      await requestPayload(),
      CUSTOM_ROLE_USER,
    );
    expect(created.requestId).toBeTruthy();
  });

  test("a TenantMember without the configured role is rejected", async () => {
    const res = await stack.http.write(
      SignatureHandlers.request,
      await requestPayload(),
      MEMBER_USER,
    );
    expect(res.status).toBe(403);
  });

  test("the configured role reads list, detail and signer list", async () => {
    const { requestId } = await stack.http.writeOk<{ requestId: string }>(
      SignatureHandlers.request,
      await requestPayload(),
      CUSTOM_ROLE_USER,
    );
    const list = await stack.http.queryOk<{ rows: { id: string }[] }>(
      SignatureQueries.list,
      {},
      CUSTOM_ROLE_USER,
    );
    expect(list.rows.map((row) => row.id)).toContain(requestId);
    const detail = await stack.http.queryOk<{ id: string }>(
      SignatureQueries.detail,
      { id: requestId },
      CUSTOM_ROLE_USER,
    );
    expect(detail.id).toBe(requestId);
    const signers = await stack.http.queryOk<{ rows: unknown[] }>(
      SignatureQueries.signerList,
      { filters: [{ field: "requestId", op: "eq", value: requestId }] },
      CUSTOM_ROLE_USER,
    );
    expect(signers.rows).toHaveLength(1);
  });

  test("a TenantMember without the configured role cannot read list, detail or signer list", async () => {
    const { requestId } = await stack.http.writeOk<{ requestId: string }>(
      SignatureHandlers.request,
      await requestPayload(),
      CUSTOM_ROLE_USER,
    );
    const requestFilter = { filters: [{ field: "requestId", op: "eq", value: requestId }] };
    const denied = [
      await stack.http.queryErr(SignatureQueries.list, {}, MEMBER_USER),
      await stack.http.queryErr(SignatureQueries.detail, { id: requestId }, MEMBER_USER),
      await stack.http.queryErr(SignatureQueries.signerList, requestFilter, MEMBER_USER),
    ];
    for (const each of denied) expect(each.httpStatus).toBe(403);
  });
});
