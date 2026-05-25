import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";

export async function anonymizeDeletedUser(
  db: DbRunner,
  params: {
    readonly email: string;
    readonly displayName: string;
    readonly status: string;
    readonly userId: string;
  },
): Promise<void> {
  await asRawClient(db).unsafe(
    'UPDATE "read_users" SET email = $1, display_name = $2, password_hash = $3, status = $4, deleted_at = now() WHERE id = $5',
    [params.email, params.displayName, null, params.status, params.userId],
  );
}
