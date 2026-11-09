// Real stack over HTTP: the signed-in handlers run as a tenant user, the link handlers as an
// anonymous caller in the default tenant. The print function is an injected stand-in that returns a
// real PDF and records the HTML it was given; the HTTP client behind the real one has its own test.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createEntityExecutor,
  createSystemUser,
  createTextField,
  defineFeature,
  SYSTEM_TENANT_ID,
  type UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables, seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { PDFDocument } from "pdf-lib";
import * as z from "zod";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import {
  requestExecutor,
  signatureRequestEntity,
  signatureRequestTable,
  signatureSignerEntity,
  signatureSignerTable,
} from "../entity.ts";
import { createSignatureFeature } from "../feature.ts";
import { signSignatureLinkToken } from "../grant.ts";
import { signatureDeleteHook, signatureExportHook } from "../user-data.ts";
import {
  SIGNATURE_INVALID_IMAGE_REASON,
  SIGNATURE_INVALID_LINK_REASON,
  SIGNATURE_MAX_LINK_OPENS,
  SIGNATURE_REQUEST_ENTITY,
  SIGNATURE_SIGNER_ENTITY,
  SignatureEvents,
  SignatureHandlers,
  SignatureJobs,
} from "../web/constants.ts";
import { makePng, toBase64 } from "./png-fixture.ts";

const LINK_SECRET = "signature-test-link-secret-0123456789";
const TENANT = testTenantId(7);
const USER = createTestUser({ id: 1, tenantId: TENANT, roles: ["TenantAdmin"] });
const SIGNATURE = toBase64(makePng());
const NON_WIN_ANSI_NAME = "Žofia Şahin 山田";

const provider = createInMemoryFileProvider();
let stack: TestStack;
let printerDown = false;
let whilePrinting: (() => Promise<void>) | null = null;
const deliveredLinks = new Map<string, string>();
const deliveredBy = new Map<string, { readonly issuerId: string }>();
const failDeliveryFor = new Set<string>();
const stubRequests: Array<{ html: string }> = [];
let ipCounter = 0;

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

const deliveryOutboxEntity = createEntity({
  table: "signature_test_delivery_outbox",
  fields: {
    signerId: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const { executor: deliveryOutboxExecutor, table: deliveryOutboxTable } = createEntityExecutor(
  "deliveryOutbox",
  deliveryOutboxEntity,
);
const DELIVERY_OUTBOX_ENQUEUE = "delivery-outbox-test:write:enqueue";

// Stands in for the app's own mail write that deliverLink dispatches.
const deliveryOutboxFeature = defineFeature("delivery-outbox-test", (r) => {
  r.entity({ name: "deliveryOutbox", ...deliveryOutboxEntity });
  r.writeHandler({
    name: "enqueue",
    schema: z.object({ signerId: z.string() }),
    handler: async (event, ctx) => deliveryOutboxExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["TenantAdmin"] },
  });
});

async function outboxSignerIds(): Promise<string[]> {
  const rows = await selectMany<{ signerId: string }>(stack.db, deliveryOutboxTable, {});
  return rows.map((row) => row.signerId);
}

async function onePagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}

function printedHtml(): string[] {
  return stubRequests.map((request) => request.html);
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
      deliveryOutboxFeature,
      createSignatureFeature({
        retention: { keepFor: "10y" },
        linkSecret: LINK_SECRET,
        renderHtmlToPdf: async (html) => {
          if (printerDown) throw new Error("print service unavailable");
          stubRequests.push({ html });
          await whilePrinting?.();
          return onePagePdf();
        },
        signaturePageUrl: "https://app.example/sign",
        deliverLink: async (ctx, { signerId, url, issuedBy }) => {
          deliveredLinks.set(signerId, url);
          deliveredBy.set(signerId, { issuerId: issuedBy.id });
          const enqueued = await ctx.dispatch.write(DELIVERY_OUTBOX_ENQUEUE, { signerId });
          if (!enqueued.isSuccess) throw new Error(`enqueue failed: ${enqueued.error.message}`);
          if (failDeliveryFor.has(signerId)) throw new Error("mail provider rejected the message");
        },
      }),
    ],
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [TENANT] },
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    trustedProxyHops: 1,
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, deliveryOutboxEntity, "deliveryOutbox");
  await unsafeCreateEntityTable(stack.db, signatureRequestEntity, SIGNATURE_REQUEST_ENTITY);
  await unsafeCreateEntityTable(stack.db, signatureSignerEntity, SIGNATURE_SIGNER_ENTITY);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  printerDown = false;
  whilePrinting = null;
  stubRequests.length = 0;
  deliveredLinks.clear();
  deliveredBy.clear();
  failDeliveryFor.clear();
  await resetTestTables(stack.db, [
    userTable,
    deliveryOutboxTable,
    signatureRequestTable,
    signatureSignerTable,
    fileRefsTable,
    eventsTable,
  ]);
  await stack.redis.flushNamespace();
});

// A PDF whose trailer points at an /Encrypt dictionary: pdf-lib refuses to load it (EncryptedPDFError).
const ENCRYPTED_PDF = new TextEncoder().encode(
  [
    "%PDF-1.4",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\nendobj",
    "4 0 obj\n<< /Filter /Standard /V 1 /R 2 >>\nendobj",
    "trailer\n<< /Root 1 0 R /Encrypt 4 0 R /Size 5 >>",
    "%%EOF",
  ].join("\n"),
);

// The requesting user uploads the document: a request needs a file its caller may open.
async function seedDocument(bytes?: Uint8Array): Promise<string> {
  const user = USER;
  const db = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "test seeds the document the signature request refers to",
  });
  const storageKey = `${TENANT}/signature/contract-${crypto.randomUUID()}.pdf`;
  const content = bytes ?? (await onePagePdf());
  await provider.write(storageKey, content, "application/pdf");
  const created = await fileRefExecutor.create(
    {
      storageKey,
      fileName: "contract.pdf",
      mimeType: "application/pdf",
      size: content.length,
    },
    user,
    db,
  );
  if (!created.isSuccess) throw new Error(`fileRef create failed: ${created.error.message}`);
  return String(created.data.id);
}

type RequestData = { requestId: string; signerIds: string[] };

async function requestSignatures(signerNames: readonly string[]): Promise<RequestData> {
  return stack.http.writeOk<RequestData>(
    SignatureHandlers.request,
    {
      documentFileId: await seedDocument(),
      title: "Rental agreement",
      subjectType: "lease",
      subjectId: "lease-1",
      signers: signerNames.map((name, index) => ({ name, email: `signer${index}@example.test` })),
    },
    USER,
  );
}

function anonymous(type: string, payload: Record<string, unknown>, ip?: string) {
  ipCounter += 1;
  return stack.http.raw(
    "POST",
    "/api/write",
    { type, payload },
    { "x-forwarded-for": ip ?? `198.51.100.${ipCounter % 250}` },
  );
}

type Answer = { status: number; body: { isSuccess: boolean; data?: unknown; error?: unknown } };

async function answer(response: Response): Promise<Answer> {
  return { status: response.status, body: (await response.json()) as Answer["body"] };
}

async function issueLink(signerId: string): Promise<string> {
  const issued = await stack.http.writeOk<Record<string, unknown>>(
    SignatureHandlers.issueLink,
    { signerId },
    USER,
  );
  expect(Object.keys(issued).sort()).toEqual(["linkSentAt", "signerId"]);
  const url = deliveredLinks.get(signerId);
  if (url === undefined) throw new Error("deliverLink was not called");
  expect(deliveredBy.get(signerId)).toEqual({ issuerId: USER.id });
  expect(await outboxSignerIds()).toContain(signerId);
  return url.slice(url.indexOf("#") + 1);
}

async function requestRow(requestId: string) {
  const rows = await selectMany(stack.db, signatureRequestTable, { id: requestId });
  const row = rows[0];
  if (row === undefined) throw new Error("request row missing");
  return row;
}

async function signerRow(signerId: string) {
  const rows = await selectMany(stack.db, signatureSignerTable, { id: signerId });
  const row = rows[0];
  if (row === undefined) throw new Error("signer row missing");
  return row;
}

async function eventsOfType(type: string) {
  const rows = await selectMany(stack.db, eventsTable, {});
  return rows.filter((row) => row["type"] === type);
}

async function runSweep(): Promise<void> {
  const runner = stack.jobRunner;
  if (!runner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
  await runner.dispatch(SignatureJobs.sweep, { tenantId: TENANT });
  await stack.drainJobs();
}

async function signInPerson(signerId: string) {
  return stack.http.writeOk(
    SignatureHandlers.signInPerson,
    { signerId, imagePngBase64: SIGNATURE },
    USER,
  );
}

async function liveSignaturePngCount(): Promise<number> {
  const refs = await selectMany<{ mimeType: string }>(stack.db, fileRefsTable, {
    isDeleted: false,
  });
  return refs.filter((ref) => ref.mimeType === "image/png").length;
}

async function tableSnapshot(table: typeof signatureRequestTable | typeof signatureSignerTable) {
  const rows = await selectMany(stack.db, table, {});
  return JSON.stringify(
    rows.map((row) => Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
  );
}

async function storedPdf(fileId: string): Promise<PDFDocument> {
  const [ref] = await selectMany<{ storageKey: string }>(stack.db, fileRefsTable, { id: fileId });
  if (ref === undefined) throw new Error("completed file ref missing");
  return PDFDocument.load(await provider.read(ref.storageKey));
}

describe("signature :: request to completed document", () => {
  test("three people, mixed in person and link, end as a completed PDF with signature page and hash", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada", NON_WIN_ANSI_NAME, "Grace"]);
    const [inPerson, linkOne, linkTwo] = signerIds as [string, string, string];

    await signInPerson(inPerson);
    const tokenOne = await issueLink(linkOne);
    const tokenTwo = await issueLink(linkTwo);

    const opened = await answer(await anonymous(SignatureHandlers.openByLink, { token: tokenOne }));
    expect(opened.status).toBe(200);
    expect(opened.body.data).toMatchObject({
      title: "Rental agreement",
      signerName: NON_WIN_ANSI_NAME,
    });

    for (const token of [tokenOne, tokenTwo]) {
      const signed = await answer(
        await anonymous(SignatureHandlers.signByLink, { token, imagePngBase64: SIGNATURE }),
      );
      expect(signed.body.isSuccess).toBe(true);
    }
    expect((await requestRow(requestId))["status"]).toBe("all-signed");

    await runSweep();

    const row = await requestRow(requestId);
    expect(row["status"]).toBe("completed");
    const completed = await storedPdf(String(row["completedFileId"]));
    expect(completed.getPageCount()).toBe(2);
    expect(printedHtml()).toHaveLength(1);
    expect(printedHtml()[0]).toContain(String(row["documentSha256"]));
    expect(printedHtml()[0]).toContain(NON_WIN_ANSI_NAME);
    expect(await eventsOfType(SignatureEvents.completed)).toHaveLength(1);

    await runSweep();
    expect(await eventsOfType(SignatureEvents.completed)).toHaveLength(1);
  });

  test("rebuilding the projections after the mixed flow leaves both tables unchanged", async () => {
    const { signerIds } = await requestSignatures(["Ada", "Grace"]);
    await signInPerson(signerIds[0] as string);
    const token = await issueLink(signerIds[1] as string);
    await anonymous(SignatureHandlers.signByLink, { token, imagePngBase64: SIGNATURE });
    await runSweep();

    const before = [
      await tableSnapshot(signatureRequestTable),
      await tableSnapshot(signatureSignerTable),
    ];
    for (const projection of [
      "signature:projection:signature-request-entity",
      "signature:projection:signature-signer-entity",
    ]) {
      await rebuildProjection(projection, {
        db: stack.db,
        registry: stack.registry,
      });
    }
    const after = [
      await tableSnapshot(signatureRequestTable),
      await tableSnapshot(signatureSignerTable),
    ];
    expect(after).toEqual(before);
  });

  test("a print service outage leaves all-signed and the job catches up later", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada"]);
    await signInPerson(signerIds[0] as string);
    printerDown = true;

    await runSweep();
    expect((await requestRow(requestId))["status"]).toBe("all-signed");
    expect(await eventsOfType(SignatureEvents.completed)).toHaveLength(0);

    printerDown = false;
    await runSweep();
    expect((await requestRow(requestId))["status"]).toBe("completed");
    expect(await eventsOfType(SignatureEvents.completed)).toHaveLength(1);
  });
});

describe("signature :: unrecoverable finalisation", () => {
  test("a changed original ends the all-signed request as failed, once", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada"]);
    await signInPerson(signerIds[0] as string);
    const row = await requestRow(requestId);
    expect(row["status"]).toBe("all-signed");

    const refs = await selectMany(stack.db, fileRefsTable, { id: String(row["documentFileId"]) });
    const storageKey = String(refs[0]?.["storageKey"]);
    const changed = await PDFDocument.create();
    changed.addPage([300, 300]);
    changed.addPage([300, 300]);
    await provider.write(storageKey, await changed.save(), "application/pdf");

    await runSweep();
    await runSweep();

    expect((await requestRow(requestId))["status"]).toBe("failed");
    const failed = await eventsOfType(SignatureEvents.failed);
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0])).toContain("document-changed");
    expect(printedHtml()).toHaveLength(0);
  });
});

describe("signature :: links", () => {
  test("every rejection answers the same: forged, revoked, expired, used up, already signed", async () => {
    const { signerIds } = await requestSignatures(["Ada", "Grace", "Alan", "Linus"]);
    const [forgedFor, revokedFor, signedFor, expiredFor] = signerIds as [
      string,
      string,
      string,
      string,
    ];

    const forged = `${forgedFor}.1.deadbeef`;
    const revokedToken = await issueLink(revokedFor);
    await stack.http.writeOk(SignatureHandlers.revokeLink, { signerId: revokedFor }, USER);
    const signedToken = await issueLink(signedFor);
    await answer(
      await anonymous(SignatureHandlers.signByLink, {
        token: signedToken,
        imagePngBase64: SIGNATURE,
      }),
    );
    await issueLink(expiredFor);
    const expiredAnchor = String((await signerRow(expiredFor))["linkAnchor"]);
    const expiredToken = signSignatureLinkToken({
      tenantId: TENANT,
      signerId: expiredFor,
      linkAnchor: expiredAnchor,
      secret: LINK_SECRET,
      now: Temporal.Now.instant().subtract({ hours: 24 * 30 }),
    }).token;

    const answers: Answer[] = [];
    for (const token of [forged, revokedToken, signedToken, expiredToken, "garbage"]) {
      answers.push(await answer(await anonymous(SignatureHandlers.openByLink, { token })));
      answers.push(
        await answer(
          await anonymous(SignatureHandlers.signByLink, { token, imagePngBase64: SIGNATURE }),
        ),
      );
    }
    const first = answers[0] as Answer;
    expect(first.status).toBe(422);
    expect(JSON.stringify(first.body)).toContain(SIGNATURE_INVALID_LINK_REASON);
    // requestId and timestamp differ per call by design; everything a caller could tell apart must not.
    const withoutTrace = (each: Answer) =>
      JSON.stringify(each, (key, value) =>
        key === "requestId" || key === "timestamp" ? undefined : value,
      );
    for (const each of answers) expect(withoutTrace(each)).toBe(withoutTrace(first));
  });

  test("a failing deliverLink rolls back its own write and the new link anchor", async () => {
    const { signerIds } = await requestSignatures(["Ada"]);
    const signerId = signerIds[0] as string;
    await issueLink(signerId);
    const before = await signerRow(signerId);
    const outboxBefore = await outboxSignerIds();

    failDeliveryFor.add(signerId);
    const failed = await stack.http.writeErr(SignatureHandlers.issueLink, { signerId }, USER);

    expect(failed.httpStatus).toBe(500);
    // The cause is only echoed in dev/test (exposesCauseDetails); the message is generic everywhere.
    expect(failed.code).toBe("internal_error");
    expect(failed.message).toBe("internal error");
    expect(await outboxSignerIds()).toEqual(outboxBefore);
    const after = await signerRow(signerId);
    expect(after["linkAnchor"]).toBe(before["linkAnchor"]);
    expect(String(after["linkSentAt"])).toBe(String(before["linkSentAt"]));
  });

  test("open-by-link works until the open limit and does not consume the link", async () => {
    const { signerIds } = await requestSignatures(["Ada"]);
    const token = await issueLink(signerIds[0] as string);

    for (let opened = 0; opened < SIGNATURE_MAX_LINK_OPENS; opened++) {
      const result = await answer(
        await anonymous(SignatureHandlers.openByLink, { token }, `203.0.113.${opened + 1}`),
      );
      expect(result.status).toBe(200);
    }
    expect((await signerRow(signerIds[0] as string))["viewCount"]).toBe(SIGNATURE_MAX_LINK_OPENS);
    const beyond = await answer(
      await anonymous(SignatureHandlers.openByLink, { token }, "203.0.113.200"),
    );
    expect(beyond.status).toBe(422);
  });

  test("two simultaneous sign-by-link calls: exactly one signs", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada", "Grace"]);
    const token = await issueLink(signerIds[0] as string);

    const results = await Promise.all(
      [1, 2].map(async (n) =>
        answer(
          await anonymous(
            SignatureHandlers.signByLink,
            { token, imagePngBase64: SIGNATURE },
            `203.0.113.${n}`,
          ),
        ),
      ),
    );

    expect(results.filter((result) => result.body.isSuccess)).toHaveLength(1);
    expect(results.filter((result) => !result.body.isSuccess)).toHaveLength(1);
    expect((await signerRow(signerIds[0] as string))["status"]).toBe("signed");
    expect(await liveSignaturePngCount()).toBe(1);
    expect((await requestRow(requestId))["status"]).toBe("open");
  });

  test("two simultaneous last signers still complete the request exactly once", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada", "Grace"]);
    const tokens = await Promise.all(signerIds.map((signerId) => issueLink(signerId)));

    await Promise.all(
      tokens.map(async (token, index) =>
        anonymous(
          SignatureHandlers.signByLink,
          { token, imagePngBase64: SIGNATURE },
          `203.0.113.${index + 1}`,
        ),
      ),
    );
    await runSweep();

    expect((await requestRow(requestId))["status"]).toBe("completed");
    expect(await eventsOfType(SignatureEvents.completed)).toHaveLength(1);
  });

  test("a new link replaces the old one", async () => {
    const { signerIds } = await requestSignatures(["Ada"]);
    const oldToken = await issueLink(signerIds[0] as string);
    await issueLink(signerIds[0] as string);
    const result = await answer(await anonymous(SignatureHandlers.openByLink, { token: oldToken }));
    expect(result.status).toBe(422);
  });
});

describe("signature :: outcomes", () => {
  test("declining through the link declines the request once and kills the other links", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada", "Grace"]);
    const [decliner, other] = signerIds as [string, string];
    const declineToken = await issueLink(decliner);
    const otherToken = await issueLink(other);

    const declined = await answer(
      await anonymous(SignatureHandlers.declineByLink, {
        token: declineToken,
        reason: "Not my document",
      }),
    );
    expect(declined.body.isSuccess).toBe(true);
    expect((await requestRow(requestId))["status"]).toBe("declined");
    expect(await eventsOfType(SignatureEvents.declined)).toHaveLength(1);

    const afterwards = await answer(
      await anonymous(SignatureHandlers.openByLink, { token: otherToken }),
    );
    expect(afterwards.status).toBe(422);
    const again = await answer(
      await anonymous(SignatureHandlers.declineByLink, { token: declineToken }),
    );
    expect(again.status).toBe(422);
    expect(await eventsOfType(SignatureEvents.declined)).toHaveLength(1);
  });

  test("cancelling invalidates the links and signing in person", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada", "Grace"]);
    const token = await issueLink(signerIds[0] as string);

    await stack.http.writeOk(SignatureHandlers.cancel, { requestId }, USER);

    expect((await requestRow(requestId))["status"]).toBe("cancelled");
    const opened = await answer(await anonymous(SignatureHandlers.openByLink, { token }));
    expect(opened.status).toBe(422);
    const inPerson = await stack.http.writeErr(
      SignatureHandlers.signInPerson,
      { signerId: signerIds[1], imagePngBase64: SIGNATURE },
      USER,
    );
    expect(inPerson.httpStatus).toBe(422);
  });

  test("a request past its deadline expires in the sweep, once, and its links die", async () => {
    const { requestId, signerIds } = await requestSignatures(["Ada"]);
    const token = await issueLink(signerIds[0] as string);
    const db = createTenantDb({
      db: stack.db,
      tenantId: TENANT,
      mode: "system",
      reason: "test moves the deadline into the past",
    });
    const moved = await requestExecutor.update(
      { id: requestId, changes: { expiresAt: Temporal.Now.instant().subtract({ hours: 1 }) } },
      createSystemUser(TENANT),
      db,
      { skipOptimisticLock: true },
    );
    expect(moved.isSuccess).toBe(true);

    await runSweep();
    await runSweep();

    expect((await requestRow(requestId))["status"]).toBe("expired");
    expect(await eventsOfType(SignatureEvents.expired)).toHaveLength(1);
    const opened = await answer(await anonymous(SignatureHandlers.openByLink, { token }));
    expect(opened.status).toBe(422);
  });
});

describe("signature :: boundaries", () => {
  const badImages: Array<[string, string]> = [
    ["empty drawing", toBase64(makePng({ drawn: false }))],
    ["not a png", toBase64(new TextEncoder().encode("this is not an image"))],
    ["not base64", "%%%"],
  ];

  test.each(badImages)("in person rejects %s", async (_label, image) => {
    const { signerIds } = await requestSignatures(["Ada"]);
    const error = await stack.http.writeErr(
      SignatureHandlers.signInPerson,
      { signerId: signerIds[0], imagePngBase64: image },
      USER,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain(SIGNATURE_INVALID_IMAGE_REASON);
  });

  test.each(badImages)(
    "by link rejects %s with the image reason, not the link reason",
    async (_label, image) => {
      const { signerIds } = await requestSignatures(["Ada"]);
      const token = await issueLink(signerIds[0] as string);
      const result = await answer(
        await anonymous(SignatureHandlers.signByLink, { token, imagePngBase64: image }),
      );
      expect(result.status).toBe(422);
      expect(JSON.stringify(result.body)).toContain(SIGNATURE_INVALID_IMAGE_REASON);
      expect((await signerRow(signerIds[0] as string))["status"]).not.toBe("signed");
    },
  );

  test("a document that is not a PDF is refused", async () => {
    const user = USER;
    const db = createTenantDb({
      db: stack.db,
      tenantId: TENANT,
      mode: "system",
      reason: "test seeds a non-PDF file",
    });
    const storageKey = `${TENANT}/signature/notes-${crypto.randomUUID()}.txt`;
    await provider.write(storageKey, new TextEncoder().encode("plain text"), "text/plain");
    const created = await fileRefExecutor.create(
      { storageKey, fileName: "notes.txt", mimeType: "text/plain", size: 10 },
      user,
      db,
    );
    if (!created.isSuccess) throw new Error("fileRef create failed");
    const error = await stack.http.writeErr(
      SignatureHandlers.request,
      {
        documentFileId: String(created.data.id),
        title: "Notes",
        subjectType: "lease",
        subjectId: "lease-1",
        signers: [{ name: "Ada" }],
      },
      USER,
    );
    expect(error.httpStatus).toBe(422);
  });

  test("an encrypted PDF is refused", async () => {
    const error = await stack.http.writeErr(
      SignatureHandlers.request,
      {
        documentFileId: await seedDocument(ENCRYPTED_PDF),
        title: "Locked",
        subjectType: "lease",
        subjectId: "lease-1",
        signers: [{ name: "Ada" }],
      },
      USER,
    );
    expect(error.httpStatus).toBe(422);
    expect(JSON.stringify(error)).toContain("document_not_a_pdf");
  });

  test("the anonymous handlers are rate limited per IP", async () => {
    const token = "garbage";
    const statuses: number[] = [];
    for (let call = 0; call < 40; call++) {
      statuses.push(
        (await anonymous(SignatureHandlers.openByLink, { token }, "192.0.2.77")).status,
      );
    }
    expect(statuses).toContain(429);
    expect(statuses[0]).toBe(422);
  });

  test("the signed-in handlers refuse an anonymous caller", async () => {
    const result = await stack.http.raw("POST", "/api/write", {
      type: SignatureHandlers.request,
      payload: {},
    });
    expect([401, 403]).toContain(result.status);
  });
});

describe("signature :: user data rights", () => {
  const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
  const USER_EMAIL = "ada@example.test";

  async function seedSignerUser(): Promise<UserDataHookCtx> {
    await seedRowViaEventStore(stack.db, userTable, {
      id: USER_ID,
      email: USER_EMAIL,
      passwordHash: "hash",
      displayName: "Ada",
      locale: "en",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.Active,
    });
    return {
      db: createTenantDb({ db: stack.db, tenantId: TENANT, mode: "tenant" }),
      registry: stack.registry,
      tenantId: TENANT,
      userId: USER_ID,
      buildStorageProvider: async () => provider,
    };
  }

  async function requestWithAdaAndGrace() {
    const { requestId, signerIds } = await stack.http.writeOk<RequestData>(
      SignatureHandlers.request,
      {
        documentFileId: await seedDocument(),
        title: "Rental agreement",
        subjectType: "lease",
        subjectId: "lease-1",
        signers: [
          { name: "Ada", email: "Ada@Example.test" },
          { name: "Grace", email: "grace@example.test" },
        ],
      },
      USER,
    );
    const [ada, grace] = signerIds as [string, string];
    await signInPerson(ada);
    return { requestId, ada, grace };
  }

  test("the export holds only the user's own signer rows, matched by email in any case", async () => {
    const ctx = await seedSignerUser();
    await requestWithAdaAndGrace();

    const exported = await signatureExportHook(ctx);

    expect(exported?.entity).toBe(SIGNATURE_SIGNER_ENTITY);
    expect(exported?.rows.map((row) => row["name"])).toEqual(["Ada"]);
  });

  test("anonymize clears the person's data and the image, keeps status, and leaves other signers alone", async () => {
    const ctx = await seedSignerUser();
    const { ada, grace } = await requestWithAdaAndGrace();
    const imageFileId = String((await signerRow(ada))["imageFileId"]);

    await signatureDeleteHook(ctx, "anonymize");

    const anonymized = await signerRow(ada);
    expect(anonymized["name"]).toBe("anonymized");
    expect(anonymized["email"]).toBeNull();
    expect(anonymized["imageFileId"]).toBeNull();
    expect(anonymized["signedFromIp"]).toBeNull();
    expect(anonymized["status"]).toBe("signed");
    const [ref] = await selectMany<{ isDeleted: boolean }>(stack.db, fileRefsTable, {
      id: imageFileId,
    });
    expect(ref?.isDeleted ?? true).toBe(true);
    expect((await signerRow(grace))["name"]).toBe("Grace");
  });

  test("delete removes the signer row and cancels the still open request", async () => {
    const ctx = await seedSignerUser();
    const { requestId, ada, grace } = await requestWithAdaAndGrace();

    await signatureDeleteHook(ctx, "delete");

    expect(await selectMany(stack.db, signatureSignerTable, { id: ada })).toHaveLength(0);
    expect((await signerRow(grace))["name"]).toBe("Grace");
    expect((await requestRow(requestId))["status"]).toBe("cancelled");
  });

  test("a request cancelled while the sweep prints stays cancelled and leaves no completed PDF behind", async () => {
    const ctx = await seedSignerUser();
    const { requestId, grace } = await requestWithAdaAndGrace();
    await signInPerson(grace);
    whilePrinting = async () => {
      whilePrinting = null;
      await signatureDeleteHook(ctx, "anonymize");
    };

    await runSweep();

    expect(printedHtml()).toHaveLength(1);
    expect((await requestRow(requestId))["status"]).toBe("cancelled");
    expect(await eventsOfType(SignatureEvents.completed)).toHaveLength(0);
    const refs = await selectMany<{ fileName: string; isDeleted: boolean }>(
      stack.db,
      fileRefsTable,
      { fileName: "signed-document.pdf" },
    );
    expect(refs.filter((ref) => !ref.isDeleted)).toHaveLength(0);
  });

  test("delete after the last signature cancels the all-signed request, the sweep completes nothing", async () => {
    const ctx = await seedSignerUser();
    const { requestId, grace } = await requestWithAdaAndGrace();
    await signInPerson(grace);
    expect((await requestRow(requestId))["status"]).toBe("all-signed");

    await signatureDeleteHook(ctx, "delete");
    await runSweep();

    expect((await requestRow(requestId))["status"]).toBe("cancelled");
    expect(await eventsOfType(SignatureEvents.completed)).toHaveLength(0);
    expect(printedHtml()).toHaveLength(0);
  });
});
