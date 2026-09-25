// fileRefStorageDelta — the single source of truth the tenant-storage-usage
// MSP's apply handlers and transferTenantStorageUsage's replay both use to
// turn one fileRef event into a signed (bytes, files) delta.

import { describe, expect, test } from "bun:test";
import { entityEventName } from "../../db";
import { fileRefStorageDelta } from "../storage-tracking";

const CREATED = entityEventName("fileRef", "created");
const DELETED = entityEventName("fileRef", "deleted");
const RESTORED = entityEventName("fileRef", "restored");

describe("fileRefStorageDelta", () => {
  test("created: positive delta from payload.size", () => {
    expect(fileRefStorageDelta({ type: CREATED, payload: { size: 42 } })).toEqual({
      bytes: 42,
      files: 1,
    });
  });

  test("created: missing/non-numeric size reads as 0 bytes, still counts a file", () => {
    expect(fileRefStorageDelta({ type: CREATED, payload: {} })).toEqual({ bytes: 0, files: 1 });
  });

  test("deleted: negative delta from payload.previous.size", () => {
    expect(fileRefStorageDelta({ type: DELETED, payload: { previous: { size: 42 } } })).toEqual({
      bytes: -42,
      files: -1,
    });
  });

  test("deleted: missing previous reads as 0 bytes, still counts -1 file", () => {
    expect(fileRefStorageDelta({ type: DELETED, payload: {} })).toEqual({ bytes: 0, files: -1 });
  });

  test("restored: positive delta from payload.previous.size, symmetric to delete", () => {
    expect(fileRefStorageDelta({ type: RESTORED, payload: { previous: { size: 42 } } })).toEqual({
      bytes: 42,
      files: 1,
    });
  });

  test("an unrelated event type returns null", () => {
    expect(fileRefStorageDelta({ type: "fileRef.renamed", payload: { size: 42 } })).toBeNull();
  });
});
