// Loads the mailbox a reconnect targets. The db is tenant-scoped, so another tenant's account id
// finds nothing. A disconnected mailbox is reconnectable on purpose: it keeps its id, threads and
// sync cursor, so reconnecting never re-imports history.

import {
  InboundMailAuthMethods,
  mailAccountsProjectionTable,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  failNotFound,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { IMAP_PROVIDER_KEY, IMAP_RECONNECT_ERRORS } from "./constants.ts";

type ReconnectAccountRow = {
  readonly id: string;
  readonly provider: string;
  readonly authMethod: string;
  readonly displayName: string | null;
  readonly status: string | null;
  readonly trustedAuthservId: string | null;
};

export type ReconnectAccountLookup =
  | { readonly isSuccess: true; readonly row: ReconnectAccountRow }
  | WriteFailure;

export async function findReconnectableAccount(
  db: Pick<TenantDb, "fetchOne">,
  accountId: string,
): Promise<ReconnectAccountLookup> {
  const row = await db.fetchOne<ReconnectAccountRow>(mailAccountsProjectionTable, {
    id: accountId,
  });
  if (!row) return failNotFound("mail-account", accountId);
  if (row.provider !== IMAP_PROVIDER_KEY || row.authMethod !== InboundMailAuthMethods.password) {
    const { reason, i18nKey } = IMAP_RECONNECT_ERRORS.notPasswordImap;
    return writeFailure(new UnprocessableError(reason, { i18nKey, details: { accountId } }));
  }
  return { isSuccess: true, row };
}
