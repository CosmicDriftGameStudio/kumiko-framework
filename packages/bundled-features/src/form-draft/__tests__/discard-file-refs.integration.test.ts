// Discard releases FileRefs held in the draft blob (issue #1915), but ONLY
// when the caller explicitly opts in via releaseFiles: true, AND only for
// storageKeys backed by a real file_refs row owned by the caller. A photo
// upload during a wizard-mode form is written to storage immediately — the
// draft blob only holds the FileRef pointer ({ id, storageKey, ... }, the
// shape POST /files returns). render-edit.tsx's only two current call sites
// both discard right after a *successful* entity submit, which already
// carries the same storageKeys into the domain entity — releasing
// unconditionally there would destroy files the entity now depends on.
// releaseFiles is for an actual abandon/abort flow instead (see schemas.ts).
//
// The ownership check matters independently of releaseFiles: `values` is
// free-form, client-supplied JSON — without verifying a real, owned
// file_refs row exists, a forged { storageKey: "<victim's key>" } would
// reach the storage provider's delete() unchecked (see
// db/queries/owned-file-refs.ts).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createInMemoryFileProvider,
  fileRefEntity,
  type InMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createConfigFeature } from "../../config";
import { FormDraftHandlers, FormDraftQueries } from "../constants";
import { formDraftEntity } from "../entity";
import { formDraftFeature } from "../feature";
import type { GetDraftResult } from "../handlers/get.query";

let stack: TestStack;
let provider: InMemoryFileProvider;

const owner = createTestUser({ id: 1, roles: ["TenantMember"] });

beforeAll(async () => {
  provider = createInMemoryFileProvider();
  stack = await setupTestStack({
    features: [formDraftFeature, createConfigFeature()],
    files: { storageProvider: provider },
  });
  await unsafeCreateEntityTable(stack.db, formDraftEntity);
  await unsafeCreateEntityTable(stack.db, fileRefEntity, "fileRef");
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  provider.clear();
  await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
  await asRawClient(stack.db).unsafe("DELETE FROM read_form_drafts");
  await asRawClient(stack.db).unsafe("DELETE FROM file_refs");
});

async function saveDraft(draftKey: string, values: Record<string, unknown>): Promise<void> {
  await stack.http.writeOk(FormDraftHandlers.save, { draftKey, values, stepIndex: 0 }, owner);
}

async function getDraft(draftKey: string): Promise<GetDraftResult> {
  return stack.http.queryOk<GetDraftResult>(FormDraftQueries.get, { draftKey }, owner);
}

async function discardDraft(draftKey: string, releaseFiles?: boolean): Promise<unknown> {
  return stack.http.writeOk(FormDraftHandlers.discard, { draftKey, releaseFiles }, owner);
}

function fileRefPointer(storageKey: string) {
  return { id: "file-1", storageKey, fileName: "photo.jpg", mimeType: "image/jpeg", size: 3 };
}

// The real file_refs row a genuine POST /files upload would have created —
// filterOwnedStorageKeys requires this to exist before a release proceeds.
async function seedFileRef(storageKey: string, ownerUser = owner): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `INSERT INTO "file_refs" ("tenant_id", "storage_key", "file_name", "mime_type", "size", "inserted_by_id")
     VALUES ($1, $2, 'photo.jpg', 'image/jpeg', 3, $3)`,
    [ownerUser.tenantId, storageKey, ownerUser.id],
  );
}

describe("form-draft discard — FileRef release", () => {
  test("discarding with releaseFiles: true and a single-file field releases its storage binary", async () => {
    const key = "tenant/vehicle/photo/one.jpg";
    await provider.write(key, new Uint8Array([1, 2, 3]), "image/jpeg");
    await seedFileRef(key);

    await saveDraft("wizard:one-photo", { photo: fileRefPointer(key) });
    expect(provider.keys()).toContain(key);

    await discardDraft("wizard:one-photo", true);

    expect(provider.keys()).not.toContain(key);
    expect((await getDraft("wizard:one-photo")).draft).toBeNull();
  });

  test("discarding with releaseFiles: true and a multi-file field releases every storage binary", async () => {
    const keyA = "tenant/vehicle/photos/a.jpg";
    const keyB = "tenant/vehicle/photos/b.jpg";
    await provider.write(keyA, new Uint8Array([1]), "image/jpeg");
    await provider.write(keyB, new Uint8Array([2]), "image/jpeg");
    await seedFileRef(keyA);
    await seedFileRef(keyB);

    await saveDraft("wizard:many-photos", {
      photos: [fileRefPointer(keyA), fileRefPointer(keyB)],
    });

    await discardDraft("wizard:many-photos", true);

    expect(provider.keys()).not.toContain(keyA);
    expect(provider.keys()).not.toContain(keyB);
  });

  test("discarding without releaseFiles leaves the storage binary intact (successful-submit default)", async () => {
    const key = "tenant/vehicle/photo/kept.jpg";
    await provider.write(key, new Uint8Array([1, 2, 3]), "image/jpeg");
    await seedFileRef(key);

    await saveDraft("wizard:submitted", { photo: fileRefPointer(key) });
    await discardDraft("wizard:submitted");

    expect(provider.keys()).toContain(key);
    expect((await getDraft("wizard:submitted")).draft).toBeNull();
  });

  test("discarding with releaseFiles: true does NOT release a storageKey with no owned file_refs row", async () => {
    const forgedKey = "tenant/vehicle/photo/victim.jpg";
    await provider.write(forgedKey, new Uint8Array([9, 9, 9]), "image/jpeg");
    // Deliberately no seedFileRef(forgedKey) — the draft's `values` claims a
    // storageKey the caller never actually uploaded (e.g. a guessed/leaked
    // key belonging to another user's real upload).

    await saveDraft("wizard:forged-pointer", { photo: fileRefPointer(forgedKey) });
    await discardDraft("wizard:forged-pointer", true);

    expect(provider.keys()).toContain(forgedKey);
  });

  test("discarding a draft without any FileRefs completes without error", async () => {
    await saveDraft("wizard:text-only", { note: "no photos here" });

    await discardDraft("wizard:text-only", true);

    expect((await getDraft("wizard:text-only")).draft).toBeNull();
  });

  test("discarding a draftKey that was never saved is a no-op and touches no storage", async () => {
    const key = "tenant/vehicle/photo/untouched.jpg";
    await provider.write(key, new Uint8Array([1]), "image/jpeg");

    await expect(discardDraft("wizard:never-saved", true)).resolves.toBeTruthy();

    expect(provider.keys()).toContain(key);
  });
});
