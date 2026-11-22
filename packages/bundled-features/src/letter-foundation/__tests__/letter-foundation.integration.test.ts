// Real stack over HTTP. A probe feature stands in for the app that calls `sendLetter`; the inmemory
// provider is steered through `letterSimulator`.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  seedConfigValues,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createTenantDb,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { PDFDocument } from "pdf-lib";
import { capCounterEntity, createCapCounterFeature } from "../../cap-counter/index.ts";
import {
  ConfigHandlers,
  configValueEntity,
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import { createLetterProviderInMemoryFeature } from "../../letter-provider-inmemory/index.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { LETTER_FEATURE, LETTER_STATE, LetterHandlers, LetterQueries } from "../constants.ts";
import { letterEntity, letterSubmissionEntity, letterTable } from "../entity.ts";
import { createLetterFoundationFeature } from "../feature.ts";
import { type SendLetterInput, SendLetterInputSchema } from "../payloads.ts";
import { sendLetter } from "../send-letter.ts";

const TENANT = testTenantId(11);
const APPROVER = createTestUser({ id: 1, tenantId: TENANT, roles: ["LetterApprover"] });
const CLERK = createTestUser({ id: 2, tenantId: TENANT, roles: ["TenantAdmin"] });
const SEND = "letter-probe:write:send";
const LIMIT_KEY = `${LETTER_FEATURE}:config:monthly-cost-limit-cents`;
const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];

const fileProvider = createInMemoryFileProvider();
const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});
let stack: TestStack;
let keyCounter = 0;

const probeFeature = defineFeature("letter-probe", (r) => {
  r.writeHandler({
    name: "send",
    schema: SendLetterInputSchema,
    access: { roles: ["TenantAdmin", "LetterApprover"] },
    handler: async (event, ctx) => sendLetter(ctx, event.payload),
  });
});

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createFilesFeature(),
      createCapCounterFeature(),
      createLetterFoundationFeature(),
      createLetterProviderInMemoryFeature(),
      probeFeature,
    ],
    files: { storageProvider: fileProvider },
    extraContext: (deps) => ({
      configResolver: resolver,
      configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, capCounterEntity, "cap-counter");
  await unsafeCreateEntityTable(stack.db, letterEntity, "letter");
  await unsafeCreateEntityTable(stack.db, letterSubmissionEntity, "letter-submission");
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(async () => {
  letterSimulator.reset();
  await resetTestTables(stack.db, [letterTable, fileRefsTable, eventsTable]);
  await stack.redis.flushNamespace();
});

async function pdfBytes(pages: number, size?: [number, number]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < pages; page += 1) pdf.addPage(size);
  return pdf.save();
}

async function seedDocument(bytes: Uint8Array): Promise<string> {
  const db = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "test seeds the document a letter refers to",
  });
  const storageKey = `${TENANT}/letters/doc-${crypto.randomUUID()}.pdf`;
  await fileProvider.write(storageKey, bytes, "application/pdf");
  const created = await fileRefExecutor.create(
    { storageKey, fileName: "doc.pdf", mimeType: "application/pdf", size: bytes.length },
    APPROVER,
    db,
  );
  if (!created.isSuccess) throw new Error(`fileRef create failed: ${created.error.message}`);
  return String(created.data.id);
}

async function letterInput(overrides: Partial<SendLetterInput> = {}): Promise<SendLetterInput> {
  keyCounter += 1;
  return {
    fileRefIds: [await seedDocument(await pdfBytes(3, A4))],
    expectedRecipient: {
      name: "Erika Mustermann",
      street: "Musterstraße",
      houseNumber: "12",
      postalCode: "12345",
      city: "Musterstadt",
    },
    shippingMode: "standard",
    color: false,
    duplex: true,
    formRequirement: "textform",
    idempotencyKey: `key-${keyCounter}`,
    source: { entityType: "invoice", entityId: `inv-${keyCounter}` },
    ...overrides,
  };
}

async function send(input: SendLetterInput) {
  return stack.http.writeOk<{ letterId: string; created: boolean }>(SEND, input, CLERK);
}

async function letterRow(letterId: string) {
  const db = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "test reads the letter row",
  });
  const rows = await selectMany<Record<string, unknown>>(db, letterTable, { id: letterId });
  return rows[0];
}

describe("sendLetter and approval", () => {
  test("creates a letter awaiting approval; the same key returns the same letter", async () => {
    const input = await letterInput();
    const first = await send(input);
    const second = await send(input);
    expect(first.created).toBe(true);
    expect(second).toEqual({ letterId: first.letterId, created: false });
    expect((await letterRow(first.letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("approving needs the approver right", async () => {
    const { letterId } = await send(await letterInput());
    const denied = await stack.http.raw("POST", "/api/write", {
      type: LetterHandlers.approve,
      payload: { letterId },
    });
    expect(denied.status).toBeGreaterThanOrEqual(400);
    const asClerk = await stack.http.writeErr(LetterHandlers.approve, { letterId }, CLERK);
    expect(asClerk.httpStatus).toBe(403);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
  });

  test("approval stores price, sheet count and the document hash", async () => {
    const { letterId } = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
    const row = await letterRow(letterId);
    expect(row?.["status"]).toBe(LETTER_STATE.approved);
    expect(row?.["pageCount"]).toBe(3);
    expect(row?.["sheetCount"]).toBe(2);
    expect(Number(row?.["quotedNet"])).toBe(85 + 2 * 12);
    expect(row?.["quotedNetCurrency"]).toBe("EUR");
    expect(row?.["priceSource"]).toBe("simulated");
    expect(String(row?.["documentSha256"])).toMatch(/^[0-9a-f]{64}$/);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("the preview shows the price and the monthly limit hint", async () => {
    const { letterId } = await send(await letterInput());
    const preview = await stack.http.queryOk<{
      totalNet: { amount: number };
      sheetCount: number;
      fitsLimit: boolean;
      hint?: string;
    }>(LetterQueries.preview, { letterId }, APPROVER);
    expect(preview.totalNet.amount).toBe(109);
    expect(preview.sheetCount).toBe(2);
    expect(preview.fitsLimit).toBe(false);
    expect(preview.hint).toBeDefined();
  });
});

describe("rejections with a readable reason", () => {
  test("schriftform is not sendable", async () => {
    const error = await stack.http.writeErr(
      SEND,
      await letterInput({ formRequirement: "schriftform" }),
      CLERK,
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toContain("schriftform");
  });

  test("a shipping mode outside the provider capabilities", async () => {
    letterSimulator.setCapabilities({ shippingModes: ["standard"] });
    const error = await stack.http.writeErr(
      SEND,
      await letterInput({ shippingMode: "rueckschein" }),
      CLERK,
    );
    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toContain("shippingModeUnsupported");
  });

  test("too many sheets and a non-A4 document fail at approval", async () => {
    letterSimulator.setCapabilities({ maxSheets: 1 });
    const tooLong = await send(await letterInput());
    const sheets = await stack.http.writeErr(
      LetterHandlers.approve,
      { letterId: tooLong.letterId },
      APPROVER,
    );
    expect(sheets.i18nKey).toContain("tooManySheets");

    letterSimulator.reset();
    const letter = await send(
      await letterInput({ fileRefIds: [await seedDocument(await pdfBytes(1, LETTER))] }),
    );
    const format = await stack.http.writeErr(
      LetterHandlers.approve,
      { letterId: letter.letterId },
      APPROVER,
    );
    expect(format.i18nKey).toContain("documentRejected");
    expect((await letterRow(letter.letterId))?.["status"]).toBe(LETTER_STATE.awaitingApproval);
  });
});

describe("cancel and config", () => {
  test("canceling before handover does not call the provider", async () => {
    const { letterId } = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.cancel, { letterId }, CLERK);
    expect((await letterRow(letterId))?.["status"]).toBe(LETTER_STATE.canceled);
    expect(letterSimulator.calls.cancel).toBe(0);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("a system row applies to a tenant without a value; a tenant admin cannot write the key", async () => {
    const seed = [{ key: LIMIT_KEY, value: 500 }];
    await seedConfigValues(seed, configValuesTable, configValueEntity, stack.registry, stack.db);
    const { letterId } = await send(await letterInput());
    const preview = await stack.http.queryOk<{ limitCents: number; fitsLimit: boolean }>(
      LetterQueries.preview,
      { letterId },
      APPROVER,
    );
    expect(preview.limitCents).toBe(500);
    expect(preview.fitsLimit).toBe(true);

    const denied = await stack.http.writeErr(
      ConfigHandlers.set,
      { key: LIMIT_KEY, value: 99999, scope: "tenant" },
      CLERK,
    );
    expect(denied.httpStatus).toBeGreaterThanOrEqual(400);
  });
});

describe("personal data", () => {
  test("no event carries the address or the recipient name in plaintext", async () => {
    const { letterId } = await send(await letterInput());
    await stack.http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
    const events = await selectMany<Record<string, unknown>>(stack.db, eventsTable, {});
    expect(events.length).toBeGreaterThan(0);
    const dump = JSON.stringify(events, (_key, value) =>
      typeof value === "bigint" ? String(value) : value,
    );
    for (const secret of ["Erika", "Mustermann", "Musterstraße", "Musterstadt", "12345"]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("boot", () => {
  test("approve is an outbound agent write and the boot accepted it", () => {
    const handler = stack.registry.getWriteHandler(LetterHandlers.approve);
    expect(handler?.agent?.effect).toBe("outbound");
  });
});
