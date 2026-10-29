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
import { createDocumentEntity, createDocumentLinkEntity } from "./entity.ts";
import { createDocumentExecutors } from "./executor.ts";
import { createImportDocumentHandler } from "./handlers/import.write.ts";
import { createLinkDocumentHandler, createUnlinkDocumentHandler } from "./handlers/link.write.ts";
import { DOCUMENTS_FEATURE_I18N } from "./i18n.ts";
import { createExpiryOverviewQuery } from "./queries/expiry-overview.query.ts";
import { createForRecordQuery, createForTypeQuery } from "./queries/for-record.query.ts";
import { createDocumentListScreen } from "./screens.ts";

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
  /** Roles that may use the document handlers. Default TenantAdmin and TenantMember. */
  readonly access?: AccessRule;
  /** Roles that see every document of their tenant whose file owner they can read, without a link. */
  readonly adminRoles?: readonly string[];
  /** Window of the "expiring" bucket in expiry-overview. Default 30 days. */
  readonly expiringWithinDays?: number;
};

function categoryOptionLabels(categories: readonly string[]) {
  return Object.fromEntries(
    categories.map((category) => [
      `documents:entity:document:field:category:option:${category}`,
      { en: category, de: category },
    ]),
  );
}

function registerDocuments(
  r: FeatureRegistrar<typeof DOCUMENTS_FEATURE_NAME>,
  opts: DocumentsFeatureOptions,
): void {
  const access = opts.access ?? DEFAULT_DOCUMENT_ACCESS;
  const linkTargets = opts.linkTargets;
  const documentEntity = createDocumentEntity({
    categories: opts.categories,
    adminRoles: opts.adminRoles ?? DEFAULT_ADMIN_ROLES,
    ...(opts.readAccess !== undefined && { readAccess: opts.readAccess }),
    ...(opts.retention !== undefined && { retention: opts.retention }),
  });
  const linkEntity = createDocumentLinkEntity(linkTargets);
  const executors = createDocumentExecutors(documentEntity, linkEntity);

  r.requires({ features: ["files"] });
  r.describe(
    "Filed documents with title, category, issue and expiry date and one file, shown on the records they are linked to. A document is visible only through a linked record the viewer can read, and only while the record that owns its file is readable too, so linking never widens access to the file. Documents arrive through capture rules (a file saved into a configured field) or through the system-only import for migrations; users link, unlink, edit and delete them. Read a record's documents with for-record, count expired and expiring ones with expiry-overview, and add the documents tab to a record screen with documentsTab().",
  );
  r.uiHints({ displayLabel: "Documents", category: "data", recommended: false });

  r.entity({ name: DOCUMENT_ENTITY, ...documentEntity });
  r.entity({ name: DOCUMENT_LINK_ENTITY, ...linkEntity });

  r.writeHandler(
    defineEntityCreateHandler(DOCUMENT_ENTITY, documentEntity, {
      access,
      description:
        "Files a new document from an uploaded file; it stays invisible to everyone but the admin roles until it is linked to a record.",
    }),
  );
  r.writeHandler(
    defineEntityUpdateHandler(DOCUMENT_ENTITY, documentEntity, {
      access,
      description:
        "Edits a document's title, category and dates from the entity-edit envelope; it does not change what the document is linked to.",
    }),
  );
  r.writeHandler(
    defineEntityDeleteHandler(DOCUMENT_ENTITY, documentEntity, {
      access,
      description:
        "Deletes a document so it disappears from every record it was linked to; the file itself stays with its owner.",
      agent: { risk: "high" },
    }),
  );
  r.writeHandler(createLinkDocumentHandler({ access, executors, linkTargets }));
  r.writeHandler(createUnlinkDocumentHandler({ access, executors, linkTargets }));
  r.writeHandler(
    createImportDocumentHandler({ executors, categories: opts.categories, linkTargets }),
  );

  r.queryHandler(
    defineEntityListHandler(DOCUMENT_ENTITY, documentEntity, {
      access,
      description:
        "Lists the documents the caller can read, filterable by category and validity date; use for-record to list one record's documents.",
    }),
  );
  r.queryHandler(
    defineEntityDetailHandler(DOCUMENT_ENTITY, documentEntity, {
      access,
      description: "Reads one document the caller can read, with its file reference and dates.",
    }),
  );
  r.queryHandler(
    defineEntityListHandler(DOCUMENT_LINK_ENTITY, linkEntity, {
      access,
      description:
        "Lists the document-to-record link rows whose record the caller can read; filter on entityId for one record's links.",
    }),
  );
  r.queryHandler(createForRecordQuery(access, linkTargets));
  for (const entityType of linkTargets) {
    r.queryHandler(createForTypeQuery(access, linkTargets, entityType));
  }
  r.queryHandler(
    createExpiryOverviewQuery(access, opts.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS),
  );

  const capture = opts.capture ?? [];
  registerCapture(r, executors, capture, linkTargets);
  r.bootCheck((ctx) => validateCaptureRules(ctx, capture, opts.categories, linkTargets));

  r.screen(createDocumentListScreen(access));
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
