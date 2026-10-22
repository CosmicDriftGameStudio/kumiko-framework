// Upload bytes are tracked in the upload ledger until their fileRef row commits; the hourly sweep
// deletes what stays unclaimed past the grace period. Time is injected, storage is the real
// in-memory provider behind the real upload paths.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  buildMultipartBody,
  createManualClock,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import type { DbTx } from "../../db/connection.ts";
import { deleteMany, selectMany } from "../../db/query.ts";
import { createTenantDb } from "../../db/tenant-db.ts";
import { defineFeature, defineWriteHandler, type WriteResult } from "../../engine/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import {
  createFileRefFromBytes,
  createFileRefFromUploadedBytes,
  uploadFileBytesBeforeTransaction,
} from "../create-file-ref-from-bytes.ts";
import { createFilesFeature } from "../feature.ts";
import { createTenantFileContext } from "../file-handle.ts";
import { fileRefsTable } from "../file-ref-table.ts";
import { createInMemoryFileProvider, type InMemoryFileProvider } from "../in-memory-provider.ts";
import {
  createFileUploadLedger,
  fileUploadLedgerTable,
  withUploadLedger,
} from "../upload-ledger.ts";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 ledger");
const GRACE_HOURS = 24;
const SWEEP_JOB = "files:job:sweep-orphaned-uploads";

const tenantA = testTenantId(1);
const userA = createTestUser({ id: 1, tenantId: tenantA, roles: ["Admin"] });

const memory: InMemoryFileProvider = createInMemoryFileProvider();
let failDeleteForKeys: ReadonlySet<string> = new Set();
// Same storage, but delete() can be told to fail for one key.
const provider: InMemoryFileProvider = {
  ...memory,
  async delete(key) {
    if (failDeleteForKeys.has(key)) throw new Error("simulated storage outage");
    await memory.delete(key);
  },
};

const clock = createManualClock(Temporal.Now.instant());

type Gate = {
  readonly reached: PromiseWithResolvers<void>;
  readonly release: PromiseWithResolvers<void>;
};
function createGate(): Gate {
  return { reached: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
}

// Holds a write between two steps so a test can run the sweep in exactly that window.
let gate: Gate | undefined;
let uploadedKey: string | undefined;

const fixtureFeature = defineFeature("upload-ledger-fixture", (r) => {
  const openToAll = { openToAll: { reason: "test fixture: every signed-in user may store bytes" } };

  r.writeHandler({
    name: "store",
    schema: z.object({}),
    access: openToAll,
    handler: (_event, ctx) =>
      createFileRefFromBytes(ctx, {
        fileName: "report.pdf",
        mimeType: "application/pdf",
        data: PDF_BYTES,
      }),
  });

  r.writeHandler({
    name: "store-then-fail",
    schema: z.object({}),
    access: openToAll,
    handler: async (_event, ctx) => {
      await createFileRefFromBytes(ctx, {
        fileName: "report.pdf",
        mimeType: "application/pdf",
        data: PDF_BYTES,
      });
      throw new Error("handler failed after the bytes were stored");
    },
  });

  // The ledger row is taken inside the handler transaction; the commit waits for the test.
  r.writeHandler({
    name: "store-and-hold-commit",
    schema: z.object({}),
    access: openToAll,
    handler: async (_event, ctx) => {
      const stored = await createFileRefFromBytes(ctx, {
        fileName: "report.pdf",
        mimeType: "application/pdf",
        data: PDF_BYTES,
      });
      gate?.reached.resolve();
      await gate?.release.promise;
      return stored;
    },
  });

  for (const [name, createRow, holdBeforeCommit] of [
    ["upload-only", false, false],
    ["upload-and-hold", true, true],
  ] as const) {
    r.writeHandler(
      defineWriteHandler({
        name,
        schema: z.object({}),
        access: openToAll,
        beforeTransaction: async (_event, ctx) => {
          const uploaded = await uploadFileBytesBeforeTransaction(ctx, {
            fileName: "report.pdf",
            mimeType: "application/pdf",
            data: PDF_BYTES,
          });
          if (!uploaded.isSuccess) return uploaded;
          uploadedKey = uploaded.data.storageKey;
          if (holdBeforeCommit) {
            gate?.reached.resolve();
            await gate?.release.promise;
          }
          return uploaded;
        },
        handler: async (event, ctx): Promise<WriteResult> =>
          createRow
            ? createFileRefFromUploadedBytes(ctx, event.prepared)
            : { isSuccess: true as const, data: {} },
      }),
    );
  }
});

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), fixtureFeature],
    files: { storageProvider: provider },
    extraContext: { clock },
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [tenantA] },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

let fileRefCountBeforeTest = 0;

async function countTenantFileRefs(): Promise<number> {
  return (await selectMany(stack.db, fileRefsTable, { tenantId: tenantA })).length;
}

beforeEach(async () => {
  fileRefCountBeforeTest = await countTenantFileRefs();
  provider.clear();
  failDeleteForKeys = new Set();
  gate = undefined;
  uploadedKey = undefined;
  clock.set(Temporal.Now.instant());
  await deleteMany(stack.db, fileUploadLedgerTable, { tenantId: tenantA });
});

async function ledgerKeys(): Promise<readonly string[]> {
  const rows = await selectMany<{ storageKey: string }>(stack.db, fileUploadLedgerTable, {
    tenantId: tenantA,
  });
  return rows.map((row) => row.storageKey);
}

async function runSweep(): Promise<void> {
  const jobRunner = stack.jobRunner;
  if (!jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
  await jobRunner.dispatch(SWEEP_JOB, {});
  await stack.drainJobs();
}

function requireKey(key: string | undefined): string {
  if (key === undefined) throw new Error("the handler did not report its storage key");
  return key;
}

const STORE = "upload-ledger-fixture:write:store";
const STORE_THEN_FAIL = "upload-ledger-fixture:write:store-then-fail";
const STORE_AND_HOLD_COMMIT = "upload-ledger-fixture:write:store-and-hold-commit";
const UPLOAD_ONLY = "upload-ledger-fixture:write:upload-only";
const UPLOAD_AND_HOLD = "upload-ledger-fixture:write:upload-and-hold";

type Stored = { id: string; storageKey: string };

describe("sweeping uploads that never got a fileRef row", () => {
  test("a pre-transaction upload without a commit is swept after the grace period", async () => {
    await stack.http.writeOk(UPLOAD_ONLY, {}, userA);
    const key = requireKey(uploadedKey);
    expect(provider.keys()).toEqual([key]);
    expect(await ledgerKeys()).toEqual([key]);

    clock.advance({ hours: GRACE_HOURS + 1 });
    await runSweep();

    expect(provider.keys()).toHaveLength(0);
    expect(await ledgerKeys()).toHaveLength(0);
  });

  test("an upload younger than the grace period is left alone", async () => {
    await stack.http.writeOk(UPLOAD_ONLY, {}, userA);
    const key = requireKey(uploadedKey);

    clock.advance({ hours: GRACE_HOURS - 1 });
    await runSweep();

    expect(provider.keys()).toEqual([key]);
    expect(await ledgerKeys()).toEqual([key]);
  });

  test("an upload is aged by the injected clock, not the wall clock", async () => {
    clock.set(Temporal.Now.instant().subtract({ hours: 24 * 30 }));
    await stack.http.writeOk(UPLOAD_ONLY, {}, userA);
    requireKey(uploadedKey);

    clock.advance({ hours: GRACE_HOURS + 1 });
    await runSweep();

    expect(provider.keys()).toHaveLength(0);
    expect(await ledgerKeys()).toHaveLength(0);
  });

  test("bytes stored in a handler whose transaction then fails are swept", async () => {
    const err = await stack.http.writeErr(STORE_THEN_FAIL, {}, userA);
    expect(err.httpStatus).toBe(500);
    expect(provider.keys()).toHaveLength(1);
    expect(await ledgerKeys()).toHaveLength(1);
    expect(await countTenantFileRefs()).toBe(fileRefCountBeforeTest);

    clock.advance({ hours: GRACE_HOURS + 1 });
    await runSweep();

    expect(provider.keys()).toHaveLength(0);
    expect(await ledgerKeys()).toHaveLength(0);
  });

  test("a failed byte delete keeps the ledger row and the next run retries it", async () => {
    await stack.http.writeOk(UPLOAD_ONLY, {}, userA);
    const key = requireKey(uploadedKey);
    failDeleteForKeys = new Set([key]);

    clock.advance({ hours: GRACE_HOURS + 1 });
    await runSweep();
    expect(provider.keys()).toEqual([key]);
    expect(await ledgerKeys()).toEqual([key]);

    failDeleteForKeys = new Set();
    await runSweep();
    expect(provider.keys()).toHaveLength(0);
    expect(await ledgerKeys()).toHaveLength(0);
  });
});

describe("uploads that commit", () => {
  test("a committed fileRef leaves no ledger row and its bytes survive the sweep", async () => {
    const stored = await stack.http.writeOk<Stored>(STORE, {}, userA);
    expect(await ledgerKeys()).toHaveLength(0);

    clock.advance({ hours: GRACE_HOURS + 1 });
    await runSweep();

    expect(provider.keys()).toEqual([stored.storageKey]);
    expect(await selectMany(stack.db, fileRefsTable, { id: stored.id })).toHaveLength(1);
  });

  test("a stale ledger row of a committed file is dropped without touching its bytes", async () => {
    const stored = await stack.http.writeOk<Stored>(STORE, {}, userA);
    await createFileUploadLedger(stack.db, tenantA).record(stored.storageKey);

    clock.advance({ hours: GRACE_HOURS + 1 });
    await runSweep();

    expect(provider.keys()).toEqual([stored.storageKey]);
    expect(await ledgerKeys()).toHaveLength(0);
  });

  test("a ledger cannot be built on a connection that is already inside a transaction", async () => {
    await stack.db.begin(async (tx: DbTx) => {
      expect(() =>
        createFileUploadLedger(createTenantDb({ db: tx, tenantId: tenantA }), tenantA),
      ).toThrow("already inside a transaction");
    });
  });

  test("POST /files leaves no ledger row after the happy path", async () => {
    const token = await stack.jwt.sign(userA);
    const formData = new FormData();
    formData.append(
      "file",
      new File([Buffer.from(PDF_BYTES)], "upload.pdf", { type: "application/pdf" }),
    );
    const { body, contentType } = await buildMultipartBody(formData);

    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body,
    });

    expect(res.status).toBe(201);
    expect(provider.keys()).toHaveLength(1);
    expect(await ledgerKeys()).toHaveLength(0);
  });
});

describe("the sweep against a commit in flight", () => {
  test("a commit holding the ledger row makes the sweep wait, then skip", async () => {
    gate = createGate();
    const writing = stack.http.writeOk<Stored>(STORE_AND_HOLD_COMMIT, {}, userA);
    await Promise.race([gate.reached.promise, writing]);

    clock.advance({ hours: GRACE_HOURS + 1 });
    // The row is locked by the open transaction, so this sweep cannot finish before the commit;
    // the gate opens without awaiting it.
    const sweeping = runSweep();
    gate.release.resolve();
    const stored = await writing;
    await sweeping;

    expect(provider.keys()).toEqual([stored.storageKey]);
    expect(await selectMany(stack.db, fileRefsTable, { id: stored.id })).toHaveLength(1);
    expect(await ledgerKeys()).toHaveLength(0);
  });

  test("a commit whose ledger row was swept fails and leaves no fileRef row", async () => {
    gate = createGate();
    const writing = stack.http.writeErr(UPLOAD_AND_HOLD, {}, userA);
    await Promise.race([gate.reached.promise, writing]);

    clock.advance({ hours: GRACE_HOURS + 1 });
    await runSweep();
    expect(provider.keys()).toHaveLength(0);

    gate.release.resolve();
    const err = await writing;

    expect(err.httpStatus).toBe(500);
    expect(err.message).toContain("upload expired");
    expect(await countTenantFileRefs()).toBe(fileRefCountBeforeTest);
    expect(await ledgerKeys()).toHaveLength(0);
  });
});

describe("tracking is opt-in", () => {
  test("a plain ref(key).write() creates no ledger row, writeUploadBytes does", async () => {
    const files = createTenantFileContext(
      withUploadLedger(() => Promise.resolve(provider), stack.db),
      tenantA,
    );
    const plainKey = `${tenantA}/exports/plain.bin`;
    const trackedKey = `${tenantA}/exports/tracked.bin`;

    await files.ref(plainKey).write(PDF_BYTES, "application/octet-stream");
    expect(await ledgerKeys()).toHaveLength(0);

    await files.writeUploadBytes(trackedKey, PDF_BYTES, "application/octet-stream");
    expect(await ledgerKeys()).toEqual([trackedKey]);

    await files.forgetUploadBytes(trackedKey);
    expect(await ledgerKeys()).toHaveLength(0);
  });

  test("uploadSweepGraceHours accepts whole hours from 1 and rejects the rest", () => {
    expect(() => createFilesFeature({ uploadSweepGraceHours: 1 })).not.toThrow();
    expect(() => createFilesFeature({ uploadSweepGraceHours: 0 })).toThrow("uploadSweepGraceHours");
    expect(() => createFilesFeature({ uploadSweepGraceHours: 1.5 })).toThrow(
      "uploadSweepGraceHours",
    );
  });
});
