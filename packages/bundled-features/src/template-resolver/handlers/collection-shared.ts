import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { EventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import type {
  ContentCollectionDefinition,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { templateResourceEntity, templateResourcesTable } from "../table.ts";
import { userContentEntriesTable, userContentEntryEntity } from "../user-content-table.ts";
import type { ContentFormat } from "../web/constants.ts";

const templateExecutor = createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
  entityName: "template-resource",
});

const userContentExecutor = createEventStoreExecutor(
  userContentEntriesTable,
  userContentEntryEntity,
  { entityName: "user-content-entry" },
);

// The columns a collection reads. Both tables carry them; the tenant-wide one
// has more (scope, status, variableSchema) that a collection never touches.
export type CollectionEntryRow = {
  readonly id: string | number;
  readonly version: number;
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly contentFormat: string;
  readonly folder: string | null;
  readonly modifiedAt: Temporal.Instant | null;
};

export type CollectionStore = {
  readonly table: typeof templateResourcesTable | typeof userContentEntriesTable;
  readonly executor: EventStoreExecutor;
  /** Extra WHERE columns scoping a read to its owner. Empty for tenant-wide. */
  scopeOf(user: SessionUser): Readonly<Record<string, unknown>>;
  /** Columns a create needs beyond the editable ones the payload carries. */
  createDefaults(tenantId: TenantId): Readonly<Record<string, unknown>>;
  /** True when `content` is stored as PII ciphertext and must be decrypted on read. */
  readonly contentIsPii: boolean;
};

// `ownership: "user"` means every user keeps their own entries (signatures);
// "tenant" means one shared set (reply snippets an admin curates).
//
// The two live in different tables — see user-content-table.ts for why a
// nullable owner column on one table cannot work with `userOwned`.
export function collectionStore(collection: ContentCollectionDefinition): CollectionStore {
  if (collection.ownership === "user") {
    return {
      table: userContentEntriesTable,
      executor: userContentExecutor,
      scopeOf: (user) => ({ ownerId: user.id }),
      createDefaults: () => ({}),
      contentIsPii: true,
    };
  }
  return {
    table: templateResourcesTable,
    executor: templateExecutor,
    scopeOf: () => ({}),
    createDefaults: (tenantId) => ({
      variableSchema: "{}",
      linkedResources: "{}",
      scope: tenantId === SYSTEM_TENANT_ID ? "system" : "tenant",
      parentTemplateId: null,
      status: "active",
    }),
    contentIsPii: false,
  };
}

// Raw reads return the stored column, which is ciphertext for a user-owned entry while a KMS
// is configured; the API's leak guard rejects any response that still carries it.
export async function readableCollectionEntry(
  row: CollectionEntryRow,
  store: CollectionStore,
  fallbackRequestId: string,
) {
  const kms = configuredPiiSubjectKms();
  if (!store.contentIsPii || !kms || row.content === null) return toCollectionEntry(row);
  const decrypted = await decryptPiiFieldValues({ content: row.content }, ["content"], kms, {
    requestId: requestContext.get()?.requestId ?? fallbackRequestId,
  });
  const content = decrypted["content"];
  return toCollectionEntry({ ...row, content: typeof content === "string" ? content : null });
}

export function toCollectionEntry(row: CollectionEntryRow) {
  return {
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    content: row.content,
    contentFormat: row.contentFormat,
    folder: row.folder,
    modifiedAt: row.modifiedAt,
  };
}

// The client never names the storage format: the declared editor decides it, so a
// stale or tampered client cannot stamp a "plain" collection with html or the reverse.
export function storageFormatOf(collection: ContentCollectionDefinition): ContentFormat {
  return collection.contentFormat === "document" ? "html" : "plain";
}
