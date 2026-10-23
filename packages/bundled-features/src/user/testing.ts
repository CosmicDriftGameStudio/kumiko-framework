// /testing re-exports /seeding. See ../tenant/testing.ts for the
// reason: helpers are shared between tests and Dev-Server bootstrap,
// and /seeding is the stable home.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  deleteRowViaEventStore,
  updateRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import { userEntity, userTable } from "./schema/user.ts";

export * from "./seeding.ts";

const userTarget = { table: userTable, entity: userEntity, entityName: "user" } as const;

// The user stream is systemStream, so the default system-tenant actor addresses it.
export function updateUserViaEventStore(
  db: DbConnection,
  userId: string,
  changes: Readonly<Record<string, unknown>>,
): Promise<void> {
  return updateRowViaEventStore(db, userTarget, { id: userId }, changes);
}

export function softDeleteUserViaEventStore(db: DbConnection, userId: string): Promise<void> {
  return deleteRowViaEventStore(db, userTarget, { id: userId });
}
