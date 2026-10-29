// documents — filed documents (title, category, validity, one file) that become visible on other
// records through link rows. A document is readable only through a record the viewer can read,
// and only while the owner of its file is readable too (EntityDefinition.readGate). Documents
// come from capture rules (a file saved into a configured field) or from the system-only import.

import {
  type AccessRule,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  type EntityDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { type DocumentCaptureRule, registerCapture, validateCaptureRules } from "./capture.ts";
import {
  DEFAULT_ADMIN_ROLES,
  DEFAULT_DOCUMENT_ACCESS,
  DEFAULT_EXPIRING_WITHIN_DAYS,
  DOCUMENT_ENTITY,
  DOCUMENT_LINK_ENTITY,
  DOCUMENTS_FEATURE_NAME,
} from "./constants.ts";
import {
  createDocumentEntity,
  createDocumentLinkEntity,
  type DocumentLinkReadMode,
} from "./entity.ts";
import { createDocumentExecutors } from "./executor.ts";
import { createImportDocumentHandler } from "./handlers/import.write.ts";
import { createLinkDocumentHandler, createUnlinkDocumentHandler } from "./handlers/link.write.ts";
import { DOCUMENTS_FEATURE_I18N } from "./i18n.ts";
import { rejectForeignPendingFile } from "./pending-file-guard.ts";
import { createExpiryOverviewQuery } from "./queries/expiry-overview.query.ts";
import { createForRecordQuery, createForTypeQuery } from "./queries/for-record.query.ts";
import { createOverviewQuery } from "./queries/overview.query.ts";
import { createDocumentListScreen } from "./screens.ts";
import { createDocumentWriteGuard } from "./write-guard.ts";

export type DocumentsFeatureOptions = {
  /** Allowed document categories; they become the options of the category field. */
  readonly categories: readonly [string, ...string[]];
  /** Entities a document can be linked to. Each needs an update handler, which linking requires. */
  readonly linkTargets: readonly [string, ...string[]];
  /** Files saved into these fields become documents automatically. */
  readonly capture?: readonly DocumentCaptureRule[];
  /** Retention of the document rows, in the entity's own retention vocabulary. */
  readonly retention?: EntityDefinition["retention"];
  /** Row-level read rule on the document, AND-ed with the link and file-owner gate. */
  readonly readAccess?: NonNullable<EntityDefinition["access"]>["read"];
  /**
   * "anyLink" (default): one readable linked record shows the document. "allLinks": the viewer
   * must read every record it is linked to, so a link to a shared record (a contact) does not
   * open a document that also hangs off a record of another team. The file-owner check applies
   * either way.
   */
  readonly linkReadMode?: DocumentLinkReadMode;
  /**
   * Who may use the document handlers. One rule applies to read, write and delete; the split form
   * sets them apart. Default TenantAdmin and TenantMember; a missing delete follows write.
   */
  readonly access?: AccessRule | DocumentsAccess;
  /** Roles that see every document of their tenant whose file owner they can read, without a link. */
  readonly adminRoles?: readonly string[];
  /** Window of the "expiring" bucket in expiry-overview. Default 30 days. */
  readonly expiringWithinDays?: number;
};

export type DocumentsAccess = {
  /** Lists, detail, for-record, the overviews and the list screen. */
  readonly read?: AccessRule;
  /** Create, update, link and unlink. */
  readonly write?: AccessRule;
  readonly delete?: AccessRule;
};

type ResolvedDocumentsAccess = Required<DocumentsAccess>;

function isAccessRule(access: AccessRule | DocumentsAccess): access is AccessRule {
  return "roles" in access || "openToAll" in access;
}

function resolveAccess(access: AccessRule | DocumentsAccess | undefined): ResolvedDocumentsAccess {
  if (access === undefined) {
    return {
      read: DEFAULT_DOCUMENT_ACCESS,
      write: DEFAULT_DOCUMENT_ACCESS,
      delete: DEFAULT_DOCUMENT_ACCESS,
    };
  }
  if (isAccessRule(access)) return { read: access, write: access, delete: access };
  const write = access.write ?? DEFAULT_DOCUMENT_ACCESS;
  return { read: access.read ?? DEFAULT_DOCUMENT_ACCESS, write, delete: access.delete ?? write };
}

function categoryOptionLabels(categories: readonly string[]) {
  return Object.fromEntries(
    categories.map((category) => [
      `documents:entity:filed-document:field:category:option:${category}`,
      { en: category, de: category },
    ]),
  );
}

function registerDocuments(
  r: FeatureRegistrar<typeof DOCUMENTS_FEATURE_NAME>,
  opts: DocumentsFeatureOptions,
): void {
  const access = resolveAccess(opts.access);
  const linkTargets = opts.linkTargets;
  const documentEntity = createDocumentEntity({
    categories: opts.categories,
    adminRoles: opts.adminRoles ?? DEFAULT_ADMIN_ROLES,
    ...(opts.readAccess !== undefined && { readAccess: opts.readAccess }),
    ...(opts.linkReadMode !== undefined && { linkReadMode: opts.linkReadMode }),
    ...(opts.retention !== undefined && { retention: opts.retention }),
  });
  const linkEntity = createDocumentLinkEntity(linkTargets);
  const executors = createDocumentExecutors(documentEntity, linkEntity);

  r.requires({ features: ["files"] });
  r.adoptsBundledLists();
  r.describe(
    "Filed documents with title, category, issue and expiry date and one file, shown on the records they are linked to. A document is visible only through a linked record the viewer can read, and only while the record that owns its file is readable too, so linking never widens access to the file. Documents arrive through capture rules (a file saved into a configured field) or through the system-only import for migrations, which keeps the caller's id, refuses an id another record already uses, and stamps createdAt with the import time (issuedAt carries the business date; the event store does not backdate); users link, unlink, edit and delete them. Read a record's documents with for-record, count expired and expiring ones with expiry-overview, list them with an expiry state and an expiring filter with overview (the documents list screen), and add the documents tab to a record screen with documentsTab().",
  );
  r.uiHints({ displayLabel: "Documents", category: "data", recommended: false });

  r.entity({ name: DOCUMENT_ENTITY, ...documentEntity });
  r.entity({ name: DOCUMENT_LINK_ENTITY, ...linkEntity });

  r.writeHandler(
    defineEntityCreateHandler(DOCUMENT_ENTITY, documentEntity, {
      access: access.write,
      description:
        "Files a new document from an uploaded file; it stays invisible to everyone but the admin roles until it is linked to a record.",
      agent: { risk: "mid" },
    }),
  );
  const writeGuard = createDocumentWriteGuard(executors, opts.adminRoles ?? DEFAULT_ADMIN_ROLES);
  r.writeHandler(
    defineEntityUpdateHandler(DOCUMENT_ENTITY, documentEntity, {
      access: access.write,
      description:
        "Edits a document's title, category and dates from the entity-edit envelope; it does not change what the document is linked to.",
      agent: { risk: "mid" },
    }),
  );
  r.writeHandler(
    defineEntityDeleteHandler(DOCUMENT_ENTITY, documentEntity, {
      access: access.delete,
      description:
        "Deletes a document so it disappears from every record it was linked to; the file itself stays with its owner.",
      agent: { risk: "high" },
    }),
  );
  r.hook({ type: "preSave", target: "filed-document:create", handler: rejectForeignPendingFile });
  r.hook({ type: "preSave", target: "filed-document:update", handler: rejectForeignPendingFile });
  r.hook({ type: "preSave", target: "filed-document:update", handler: writeGuard.beforeUpdate });
  r.hook({ type: "preDelete", target: "filed-document:delete", handler: writeGuard.beforeDelete });
  r.writeHandler(createLinkDocumentHandler({ access: access.write, executors, linkTargets }));
  r.writeHandler(createUnlinkDocumentHandler({ access: access.write, executors, linkTargets }));
  r.writeHandler(
    createImportDocumentHandler({ executors, categories: opts.categories, linkTargets }),
  );

  r.queryHandler(
    defineEntityListHandler(DOCUMENT_ENTITY, documentEntity, {
      access: access.read,
      description:
        "Lists the documents the caller can read, filterable by category and validity date; use for-record to list one record's documents.",
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler(DOCUMENT_ENTITY, documentEntity, {
      access: access.read,
      description: "Reads one document the caller can read, with its file reference and dates.",
    }),
  );
  r.queryHandler(
    defineEntityListHandler(DOCUMENT_LINK_ENTITY, linkEntity, {
      access: access.read,
      description:
        "Lists the document-to-record link rows whose record the caller can read; filter on entityId for one record's links.",
    }),
  );
  r.queryHandler(createForRecordQuery(access.read, linkTargets));
  for (const entityType of linkTargets) {
    r.queryHandler(createForTypeQuery(access.read, linkTargets, entityType));
  }
  const expiringWithinDays = opts.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS;
  r.queryHandler(createExpiryOverviewQuery(access.read, expiringWithinDays));
  r.queryHandler(createOverviewQuery(access.read, expiringWithinDays));

  const capture = opts.capture ?? [];
  registerCapture(r, executors, capture, linkTargets);
  r.bootCheck((ctx) => validateCaptureRules(ctx, capture, opts.categories, linkTargets));

  r.screen(createDocumentListScreen(access.read, opts.categories));
  r.translations({
    keys: { ...DOCUMENTS_FEATURE_I18N, ...categoryOptionLabels(opts.categories) },
  });
}

export function createDocumentsFeature(opts: DocumentsFeatureOptions) {
  if (opts.expiringWithinDays !== undefined && opts.expiringWithinDays < 0) {
    throw new Error("createDocumentsFeature({ expiringWithinDays }) must not be negative.");
  }
  return defineFeature(DOCUMENTS_FEATURE_NAME, (r) => registerDocuments(r, opts));
}
