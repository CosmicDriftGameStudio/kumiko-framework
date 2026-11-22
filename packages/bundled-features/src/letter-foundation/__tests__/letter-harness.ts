// Shared stack and helpers of the letter integration tests: real HTTP over `setupTestStack`, a probe
// feature that stands in for the app calling `sendLetter`, and the inmemory provider steered through `letterSimulator`.

import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  defineFeature,
  type FeatureDefinition,
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
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { PDFDocument } from "pdf-lib";
import {
  CapCounterQueries,
  capCounterEntity,
  capReservationsTableMeta,
  createCapCounterFeature,
  currentCalendarMonthStartIso,
} from "../../cap-counter/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import {
  type ConfigResolver,
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import { tenantRetentionOverrideEntity } from "../../data-retention/schema/tenant-retention-override.ts";
import { createLetterProviderInMemoryFeature } from "../../letter-provider-inmemory/index.ts";
import { letterSimulator } from "../../letter-provider-inmemory/simulator.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipEntity } from "../../tenant/index.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  LETTER_CAP,
  LETTER_MONTHLY_COST_LIMIT_CONFIG,
  LetterHandlers,
  type LetterShippingMode,
} from "../constants.ts";
import {
  letterEntity,
  letterSubmissionEntity,
  letterSubmissionTable,
  letterTable,
} from "../entity.ts";
import { createLetterFoundationFeature, type LetterFoundationOptions } from "../feature.ts";
import { type SendLetterInput, SendLetterInputSchema } from "../payloads.ts";
import { sendLetter } from "../send-letter.ts";

export const TENANT = testTenantId(11);
export const APPROVER = createTestUser({ id: 1, tenantId: TENANT, roles: ["LetterApprover"] });
export const CLERK = createTestUser({ id: 2, tenantId: TENANT, roles: ["TenantAdmin"] });
export const SYSTEM_ADMIN = createTestUser({ id: 3, tenantId: TENANT, roles: ["SystemAdmin"] });
export const SEND = "letter-probe:write:send";
export const LIMIT_KEY = LETTER_MONTHLY_COST_LIMIT_CONFIG;
export const A4: [number, number] = [595.28, 841.89];
export const LETTER_SIZE: [number, number] = [612, 792];
export const SET_PROFILE = "compliance-profiles:write:set-profile";
export const START_INSTANT = "2026-06-10T10:00:00Z";

const { table: capCounterTable } = createEntityExecutor(capCounterEntity);
const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

type ParkOutcome = "continue" | "fail";

/** A run held at one point until the test decides how it goes on. */
export type ParkedRun = {
  readonly reached: Promise<void>;
  resume(outcome: ParkOutcome): void;
};

type ParkingSlot = {
  readonly run: ParkedRun;
  readonly outcome: Promise<ParkOutcome>;
  signalReached(): void;
};

function createParkingSlot(): ParkingSlot {
  let signalReached: () => void = () => undefined;
  let resume: (outcome: ParkOutcome) => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  const outcome = new Promise<ParkOutcome>((resolve) => {
    resume = resolve;
  });
  return { run: { reached, resume }, outcome, signalReached: () => signalReached() };
}

const probeFeature = defineFeature("letter-probe", (r) => {
  r.writeHandler({
    name: "send",
    schema: SendLetterInputSchema,
    access: { roles: ["TenantAdmin", "LetterApprover"] },
    handler: async (event, ctx) => sendLetter(ctx, event.payload),
  });
});

export type LetterHarness = ReturnType<typeof createLetterHarness>;

export function createLetterHarness(
  foundationOptions: LetterFoundationOptions = {},
  extraFeatures: readonly FeatureDefinition[] = [],
) {
  const fileProvider = createInMemoryFileProvider();
  let stack: TestStack | undefined;
  let keyCounter = 0;

  function current(): TestStack {
    if (stack === undefined) throw new Error("letter harness is not set up");
    return stack;
  }

  let limitReadSlot: ParkingSlot | undefined;

  // Parks the next read of the monthly limit: the handover run has inserted its claim but reserved nothing yet.
  function limitReadGate(resolver: ConfigResolver): ConfigResolver {
    return {
      ...resolver,
      async get(...args) {
        const slot = args[0] === LIMIT_KEY ? limitReadSlot : undefined;
        if (slot !== undefined) {
          limitReadSlot = undefined;
          slot.signalReached();
          await slot.outcome;
        }
        return resolver.get(...args);
      },
    };
  }

  function parkNextLimitRead(): ParkedRun {
    const slot = createParkingSlot();
    limitReadSlot = slot;
    return slot.run;
  }

  // Parks the next document read: the handover run holds its claim and reservation but has not left `approved`.
  // "fail" lets the read throw, which is how a run stops there.
  function parkNextDocumentRead(): ParkedRun {
    const original = fileProvider.read.bind(fileProvider);
    const slot = createParkingSlot();
    fileProvider.read = async (key) => {
      fileProvider.read = original;
      slot.signalReached();
      if ((await slot.outcome) === "fail") throw new Error("storage unavailable");
      return original(key);
    };
    return slot.run;
  }

  /** Runs a job and waits for the job queue to empty without delivering any event, so the submit job
   *  stays out of it and what the job did alone can be read. */
  async function runJobWithoutEventDelivery(
    jobName: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const runner = current().jobRunner;
    if (runner === undefined) throw new Error("the stack has no job runner");
    await runner.dispatch(jobName, payload);
    const deadline = Date.now() + 10_000;
    for (let idlePasses = 0; idlePasses < 2; ) {
      if (Date.now() > deadline) throw new Error(`${jobName} did not finish within 10 s`);
      idlePasses = (await runner.countPendingJobs()) === 0 ? idlePasses + 1 : 0;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function setup(): Promise<TestStack> {
    resetPiiSubjectKmsForTests();
    configurePiiSubjectKms(new InMemoryKmsAdapter());
    const resolver = limitReadGate(createConfigResolver());
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        createFilesFeature(),
        createCapCounterFeature(),
        createLetterFoundationFeature(foundationOptions),
        createLetterProviderInMemoryFeature(),
        probeFeature,
        ...extraFeatures,
      ],
      files: { storageProvider: fileProvider },
      now: START_INSTANT,
      jobs: { consumerLane: "worker", getActiveTenantIds: async () => [TENANT] },
      extraContext: (deps) => ({
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
      }),
    });
    const db = stack.db;
    await unsafePushTables(db, { configValuesTable });
    await unsafeCreateEntityTable(db, tenantEntity);
    await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
    await unsafeCreateEntityTable(db, tenantMembershipEntity);
    await unsafeCreateEntityTable(db, tenantRetentionOverrideEntity);
    await unsafeCreateEntityTable(db, capCounterEntity, "cap-counter");
    await unsafeCreateEntityTable(db, letterEntity, "letter");
    await unsafeCreateEntityTable(db, letterSubmissionEntity, "letter-submission");
    letterSimulator.setClock(() => current().clock?.now() ?? Temporal.Now.instant());
    return stack;
  }

  async function reset(): Promise<void> {
    const s = current();
    letterSimulator.reset();
    letterSimulator.setClock(() => current().clock?.now() ?? Temporal.Now.instant());
    s.clock?.set(Temporal.Instant.from(START_INSTANT));
    fileProvider.clear();
    await resetTestTables(s.db, [
      letterTable,
      letterSubmissionTable,
      fileRefsTable,
      eventsTable,
      capCounterTable,
      capReservationsTableMeta,
      tenantTable,
      tenantComplianceProfileTable,
    ]);
    await s.redis.flushNamespace();
    await s.drainJobs();
  }

  async function cleanup(): Promise<void> {
    await current().cleanup();
    resetPiiSubjectKmsForTests();
  }

  async function pdfBytes(pages: number, size?: [number, number]): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    for (let page = 0; page < pages; page += 1) pdf.addPage(size);
    return pdf.save();
  }

  async function seedDocument(bytes: Uint8Array): Promise<string> {
    const db = createTenantDb({
      db: current().db,
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

  function send(input: SendLetterInput, user: SessionUser = CLERK) {
    return current().http.writeOk<{ letterId: string; created: boolean }>(SEND, input, user);
  }

  async function letterRow(letterId: string) {
    const db = createTenantDb({
      db: current().db,
      tenantId: TENANT,
      mode: "system",
      reason: "test reads the letter row",
    });
    const rows = await selectMany<Record<string, unknown>>(db, letterTable, { id: letterId });
    return rows[0];
  }

  async function claimRows(letterId?: string) {
    const db = createTenantDb({
      db: current().db,
      tenantId: TENANT,
      mode: "system",
      reason: "test reads the claim rows",
    });
    const rows = await selectMany<Record<string, unknown>>(db, letterSubmissionTable, {});
    return letterId === undefined ? rows : rows.filter((row) => row["letterId"] === letterId);
  }

  async function counter(capName: string): Promise<number> {
    const now = current().clock?.now() ?? Temporal.Now.instant();
    const periodStartIso = currentCalendarMonthStartIso(now);
    const row = await current().http.queryOk<Record<string, unknown> | null>(
      CapCounterQueries.getCounter,
      { capName, periodStartIso },
      CLERK,
    );
    return typeof row?.["value"] === "number" ? row["value"] : 0;
  }

  async function usage(mode: LetterShippingMode = "standard") {
    return {
      cost: await counter(LETTER_CAP.costNetCents),
      count: await counter(LETTER_CAP.count(mode)),
      sheets: await counter(LETTER_CAP.sheets(mode)),
      pages: await counter(LETTER_CAP.pages),
    };
  }

  async function approve(letterId: string): Promise<void> {
    await current().http.writeOk(LetterHandlers.approve, { letterId }, APPROVER);
  }

  /** Approves and lets the handover job finish. */
  async function approveAndSubmit(letterId: string): Promise<void> {
    await approve(letterId);
    await current().drainJobs();
  }

  async function seedTenant(): Promise<void> {
    await current().http.writeOk(
      TenantHandlers.create,
      { id: TENANT, key: `t-${TENANT}`, name: "Tenant" },
      SYSTEM_ADMIN,
    );
    await current().http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, CLERK);
  }

  return {
    fileProvider,
    stack: current,
    setup,
    reset,
    cleanup,
    pdfBytes,
    seedDocument,
    letterInput,
    send,
    letterRow,
    claimRows,
    counter,
    usage,
    approve,
    approveAndSubmit,
    parkNextDocumentRead,
    parkNextLimitRead,
    runJobWithoutEventDelivery,
    seedTenant,
  };
}
