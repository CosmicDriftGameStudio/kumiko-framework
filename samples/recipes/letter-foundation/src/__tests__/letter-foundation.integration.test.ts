// The hold time runs on the stack's manual clock, so the handover never needs a real wait.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  CapCounterQueries,
  createCapCounterFeature,
  currentCalendarMonthStartIso,
} from "@cosmicdrift/kumiko-bundled-features/cap-counter";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  ConfigHandlers,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createLetterFoundationFeature,
  LETTER_CAP,
  LETTER_FAILURE_REASON,
  LETTER_MONTHLY_COST_LIMIT_CONFIG,
  LETTER_ROLES,
  LETTER_STATE,
  LetterHandlers,
  LetterJobs,
  LetterQueries,
} from "@cosmicdrift/kumiko-bundled-features/letter-foundation";
import {
  createLetterProviderInMemoryFeature,
  letterSimulator,
} from "@cosmicdrift/kumiko-bundled-features/letter-provider-inmemory";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createTenantDb, resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { PDFDocument } from "pdf-lib";
import { createStatementsFeature } from "../feature";

const TENANT = testTenantId(11);
const CLERK = createTestUser({ id: 2, tenantId: TENANT, roles: ["TenantAdmin"] });
const APPROVER = createTestUser({ id: 1, tenantId: TENANT, roles: [LETTER_ROLES.approver] });
const SYSTEM_ADMIN = createTestUser({ id: 3, tenantId: TENANT, roles: ["SystemAdmin"] });

const SEND = "statements:write:send-statement-letter";
const LIMIT_KEY = LETTER_MONTHLY_COST_LIMIT_CONFIG;
const START_INSTANT = "2026-06-10T10:00:00Z";
const RECIPIENT = {
  name: "Erika Mustermann",
  street: "Musterstrasse",
  houseNumber: "12",
  postalCode: "12345",
  city: "Musterstadt",
};

type LetterDetail = { status: string; failureReason?: string };

const fileProvider = createInMemoryFileProvider();
const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});
let stack: TestStack;
let statementCounter = 0;

beforeAll(async () => {
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createFilesFeature(),
      createCapCounterFeature(),
      // The default hold of 5 minutes is a real queue delay; a short one keeps the test fast.
      createLetterFoundationFeature({ handoverHoldMs: 300 }),
      createLetterProviderInMemoryFeature(),
      createStatementsFeature(),
    ],
    files: { storageProvider: fileProvider },
    now: START_INSTANT,
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [TENANT] },
    extraContext: (deps) => ({
      configResolver: resolver,
      configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });
  letterSimulator.reset();
  letterSimulator.setClock(() => stack.clock?.now() ?? Temporal.Now.instant());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

async function seedPdf(): Promise<string> {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < 3; page += 1) pdf.addPage();
  const bytes = await pdf.save();
  const storageKey = `${TENANT}/letters/doc-${crypto.randomUUID()}.pdf`;
  await fileProvider.write(storageKey, bytes, "application/pdf");
  const db = createTenantDb({
    db: stack.db,
    tenantId: TENANT,
    mode: "system",
    reason: "sample seeds the PDF a statement letter refers to",
  });
  const created = await fileRefExecutor.create(
    { storageKey, fileName: "statement.pdf", mimeType: "application/pdf", size: bytes.length },
    APPROVER,
    db,
  );
  if (!created.isSuccess) throw new Error(`fileRef create failed: ${created.error.message}`);
  return String(created.data.id);
}

async function statementPayload(overrides: Record<string, unknown> = {}) {
  statementCounter += 1;
  return {
    statementId: `statement-${statementCounter}`,
    fileRefId: await seedPdf(),
    recipient: RECIPIENT,
    formRequirement: "textform",
    ...overrides,
  };
}

function sendStatement(payload: Record<string, unknown>) {
  return stack.http.writeOk<{ letterId: string; created: boolean }>(SEND, payload, CLERK);
}

function detailOf(letterId: string) {
  return stack.http.queryOk<LetterDetail>(LetterQueries.detail, { id: letterId }, CLERK);
}

async function counter(capName: string): Promise<number> {
  const now = stack.clock?.now() ?? Temporal.Now.instant();
  const row = await stack.http.queryOk<Record<string, unknown> | null>(
    CapCounterQueries.getCounter,
    { capName, periodStartIso: currentCalendarMonthStartIso(now) },
    CLERK,
  );
  return typeof row?.["value"] === "number" ? row["value"] : 0;
}

describe("letter-foundation sample", () => {
  // Runs before the limit is set: a tenant without a limit may not send anything.
  test("without a monthly limit the handover fails with monthly-limit", async () => {
    const { letterId } = await sendStatement(await statementPayload());
    await stack.http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
    stack.clock?.advance({ seconds: 1 });
    await stack.drainJobs();
    const detail = await detailOf(letterId);
    expect(detail.status).toBe(LETTER_STATE.failed);
    expect(detail.failureReason).toBe(LETTER_FAILURE_REASON.monthlyLimit);
    expect(letterSimulator.calls.submit).toBe(0);
  });

  test("a statement becomes one letter that waits for approval, a repeat returns the same one", async () => {
    const payload = await statementPayload();
    const first = await sendStatement(payload);
    const second = await sendStatement(payload);
    expect(first.created).toBe(true);
    expect(second).toEqual({ letterId: first.letterId, created: false });
    expect((await detailOf(first.letterId)).status).toBe(LETTER_STATE.awaitingApproval);
  });

  test("schriftform needs the acknowledged risk", async () => {
    const rejected = await stack.http.writeErr(
      SEND,
      await statementPayload({ formRequirement: "schriftform" }),
      CLERK,
    );
    expect(rejected.httpStatus).toBe(422);
    expect(rejected.i18nKey).toContain("schriftform");

    const accepted = await sendStatement(
      await statementPayload({ formRequirement: "schriftform", formRiskAcknowledged: true }),
    );
    expect(accepted.created).toBe(true);
  });

  test("approved with a limit, the letter is handed over and polled to sent", async () => {
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: LIMIT_KEY, value: 100_000, scope: "tenant" },
      SYSTEM_ADMIN,
    );
    const costBefore = await counter(LETTER_CAP.costNetCents);
    const countBefore = await counter(LETTER_CAP.count("standard"));

    const { letterId } = await sendStatement(await statementPayload());
    const preview = await stack.http.queryOk<{ totalNet: { amount: number }; fitsLimit: boolean }>(
      LetterQueries.preview,
      { letterId },
      APPROVER,
    );
    expect(preview.fitsLimit).toBe(true);

    await stack.http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
    stack.clock?.advance({ seconds: 1 });
    await stack.drainJobs();
    expect((await detailOf(letterId)).status).toBe(LETTER_STATE.accepted);
    expect(letterSimulator.submissions[0]?.reference).toBe(letterId);

    // The simulator moves an order to its final state a few minutes after acceptance.
    stack.clock?.advance({ minutes: 11 });
    await stack.jobRunner?.dispatch(LetterJobs.poll, {});
    await stack.drainJobs();
    expect((await detailOf(letterId)).status).toBe(LETTER_STATE.sent);

    expect(await counter(LETTER_CAP.costNetCents)).toBe(costBefore + preview.totalNet.amount);
    expect(await counter(LETTER_CAP.count("standard"))).toBe(countBefore + 1);
  });
});
