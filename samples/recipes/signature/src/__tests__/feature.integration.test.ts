import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createDataRetentionFeature } from "@cosmicdrift/kumiko-bundled-features/data-retention";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createUserDataRightsFeature } from "@cosmicdrift/kumiko-bundled-features/user-data-rights";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { PDFDocument } from "pdf-lib";
import { deliveredLinks, signatureFeature } from "../feature";

const TENANT = testTenantId(1);
const admin = createTestUser({ roles: ["TenantAdmin"], tenantId: TENANT });
const SIGNATURE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAACgAAAAQCAYAAABk1z2tAAAANklEQVR4nGNgYGD4j4QHJUB24KB0LC4HDjqHgsCoY0dDdTS9jmas0SJrtGwdrbVGq9f/yCUBAOaodYsn7bfwAAAAAElFTkSuQmCC";

const provider = createInMemoryFileProvider();
let stack: TestStack;

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
      signatureFeature,
    ],
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [TENANT] },
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

// The requester uploads the contract: a request needs a document its caller may open.
async function seedContract(): Promise<string> {
  const bytes = await (async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    return pdf.save();
  })();
  const storageKey = `${TENANT}/contract.pdf`;
  await provider.write(storageKey, bytes, "application/pdf");
  const db = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "recipe seeds the document the request refers to",
  });
  const created = await createEventStoreExecutor(fileRefsTable, fileRefEntity, {
    entityName: "fileRef",
  }).create(
    { storageKey, fileName: "contract.pdf", mimeType: "application/pdf", size: bytes.length },
    admin,
    db,
  );
  if (!created.isSuccess) throw new Error(created.error.message);
  return String(created.data.id);
}

describe("signature recipe", () => {
  test("a link is delivered, never returned, and the last signature completes the request", async () => {
    const { requestId, signerIds } = await stack.http.writeOk<{
      requestId: string;
      signerIds: string[];
    }>(
      "signature:write:request",
      {
        documentFileId: await seedContract(),
        title: "Rental agreement",
        subjectType: "lease",
        subjectId: "lease-1",
        signers: [{ name: "Ada", email: "ada@example.test" }],
      },
      admin,
    );
    const signerId = signerIds[0] as string;

    const issued = await stack.http.writeOk<Record<string, unknown>>(
      "signature:write:issue-link",
      { signerId },
      admin,
    );
    expect(Object.keys(issued).sort()).toEqual(["linkSentAt", "signerId"]);

    const url = deliveredLinks.get(signerId) ?? "";
    expect(url.startsWith("https://app.example/sign#")).toBe(true);
    const signed = await stack.http.raw("POST", "/api/write", {
      type: "signature:write:sign-by-link",
      payload: { token: url.slice(url.indexOf("#") + 1), imagePngBase64: SIGNATURE_PNG },
    });
    expect(signed.status).toBe(200);

    await stack.jobRunner?.dispatch("signature:job:sweep", { tenantId: TENANT });
    await stack.drainJobs();

    const request = await stack.http.queryOk<{ status: string }>(
      "signature:query:signature-request:detail",
      { id: requestId },
      admin,
    );
    expect(request.status).toBe("completed");
  });
});
