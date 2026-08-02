import type { EventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import type {
  AccessRule,
  ContentCollectionDefinition,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { templateResourceEntity, templateResourcesTable } from "../table";
import { userContentEntriesTable, userContentEntryEntity } from "../user-content-table";

// Applies when an app mounts a collection without saying who may reach it.
// Deliberately narrow: a collection whose access nobody decided should be
// invisible to normal users rather than open by default.
export const DEFAULT_COLLECTION_ACCESS: AccessRule = { roles: ["TenantAdmin", "SystemAdmin"] };

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
  readonly folder: string | null;
  readonly updatedAt: Date;
};

export type CollectionStore = {
  readonly table: typeof templateResourcesTable | typeof userContentEntriesTable;
  readonly executor: EventStoreExecutor;
  /** Extra WHERE columns scoping a read to its owner. Empty for tenant-wide. */
  scopeOf(user: SessionUser): Readonly<Record<string, unknown>>;
  /** Columns a create needs beyond the editable ones the payload carries. */
  createDefaults(tenantId: TenantId): Readonly<Record<string, unknown>>;
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
  };
}

export function toCollectionEntry(row: CollectionEntryRow) {
  return {
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    content: row.content,
    folder: row.folder,
    updatedAt: row.updatedAt,
  };
}
