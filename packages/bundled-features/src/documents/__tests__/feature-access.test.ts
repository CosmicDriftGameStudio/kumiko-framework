import { describe, expect, test } from "bun:test";
import { type AccessRule, SYSTEM_ROLE } from "@cosmicdrift/kumiko-framework/engine";
import { DocumentsHandlers, DocumentsQueries } from "../constants.ts";
import { createDocumentsFeature, type DocumentsFeatureOptions } from "../feature.ts";

const CREATE = "documents:write:filed-document:create";
const UPDATE = "documents:write:filed-document:update";
const DELETE = "documents:write:filed-document:delete";

function featureWith(access: DocumentsFeatureOptions["access"]) {
  return createDocumentsFeature({
    categories: ["contract"],
    linkTargets: ["property"],
    ...(access !== undefined && { access }),
  });
}

function accessOf(feature: ReturnType<typeof featureWith>, qn: string): AccessRule | undefined {
  // The feature keys its handlers without the "documents:write:" / "documents:query:" prefix.
  const name = qn.split(":").slice(2).join(":");
  return feature.writeHandlers[name]?.access ?? feature.queryHandlers[name]?.access;
}

const readers: AccessRule = { roles: ["Reader"] };
const writers: AccessRule = { roles: ["Writer"] };
const deleters: AccessRule = { roles: ["Deleter"] };

describe("documents access", () => {
  test("one rule covers read, write and delete", () => {
    const feature = featureWith(writers);
    for (const qn of [CREATE, UPDATE, DELETE, DocumentsHandlers.link, DocumentsQueries.list]) {
      expect(accessOf(feature, qn)).toEqual(writers);
    }
  });

  test("the split form sets read, write and delete apart", () => {
    const feature = featureWith({ read: readers, write: writers, delete: deleters });
    for (const qn of [
      DocumentsQueries.list,
      DocumentsQueries.detail,
      DocumentsQueries.forRecord,
      DocumentsQueries.overview,
      DocumentsQueries.expiryOverview,
    ]) {
      expect(accessOf(feature, qn)).toEqual(readers);
    }
    for (const qn of [CREATE, UPDATE, DocumentsHandlers.link, DocumentsHandlers.unlink]) {
      expect(accessOf(feature, qn)).toEqual(writers);
    }
    expect(accessOf(feature, DELETE)).toEqual(deleters);
  });

  test("a missing delete follows write, a missing read keeps the default", () => {
    const feature = featureWith({ write: writers });
    expect(accessOf(feature, DELETE)).toEqual(writers);
    expect(accessOf(feature, DocumentsQueries.list)).toEqual({
      roles: ["TenantAdmin", "TenantMember"],
    });
  });

  test("the import stays reserved for the system user whatever the access", () => {
    const feature = featureWith({ read: readers, write: writers, delete: deleters });
    expect(accessOf(feature, DocumentsHandlers.import)).toEqual({ roles: [SYSTEM_ROLE] });
  });
});
