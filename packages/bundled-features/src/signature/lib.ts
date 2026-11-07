import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  type AccessRule,
  access,
  type HandlerContext,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { requestExecutor, signerExecutor } from "./entity.ts";
import {
  SIGNATURE_INVALID_LINK_REASON,
  SIGNATURE_REQUEST_STATUS,
  SIGNATURE_SIGNER_STATUS,
  type SignatureRequestStatus,
} from "./web/constants.ts";

export const DEFAULT_SIGNATURE_ACCESS: AccessRule = { roles: ["TenantAdmin", "TenantMember"] };

export const internalAccess = { roles: access.system } as const;

export const SIGNATURE_OUTCOME_AGGREGATE_TYPE = "signature-outcome" as const;

export type RequestRow = NonNullable<Awaited<ReturnType<typeof requestExecutor.detail>>>;
export type SignerRow = NonNullable<Awaited<ReturnType<typeof signerExecutor.detail>>>;

// Same body and status for every link rejection: forged, expired, revoked, used up, signed already.
export function invalidLink() {
  return writeFailure(new UnprocessableError(SIGNATURE_INVALID_LINK_REASON));
}

export function instantOrNull(value: unknown): Temporal.Instant | null {
  return value instanceof Temporal.Instant ? value : null;
}

export function isPastInstant(value: unknown, now: Temporal.Instant): boolean {
  const instant = instantOrNull(value);
  return instant !== null && Temporal.Instant.compare(instant, now) <= 0;
}

export function isOpenRequest(request: RequestRow, now: Temporal.Instant): boolean {
  return request.status === SIGNATURE_REQUEST_STATUS.Open && !isPastInstant(request.expiresAt, now);
}

export function isUnsignedSigner(signer: SignerRow): boolean {
  return (
    signer.status === SIGNATURE_SIGNER_STATUS.Pending ||
    signer.status === SIGNATURE_SIGNER_STATUS.Viewed
  );
}

// Equals the executor's MAX_LIST_LIMIT.
const LIST_PAGE_SIZE = 200;

export async function listSigners(
  ctx: { readonly db: TenantDb },
  user: SessionUser,
  requestId: string,
): Promise<readonly SignerRow[]> {
  const found = await signerExecutor.list(
    { filter: { field: "requestId", op: "eq", value: requestId }, limit: LIST_PAGE_SIZE },
    user,
    ctx.db,
  );
  return found.rows;
}

export function versionOf(row: { readonly version?: unknown }): number | undefined {
  return typeof row.version === "number" ? row.version : undefined;
}

export async function setRequestStatus(
  ctx: { readonly db: TenantDb },
  user: SessionUser,
  requestId: string,
  from: SignatureRequestStatus,
  changes: Readonly<Record<string, unknown>>,
) {
  return requestExecutor.update({ id: requestId, changes }, user, ctx.db, {
    skipOptimisticLock: true,
    expect: { status: from },
  });
}

// Moves an open request to all-signed once every signer has signed. Two signers committing at the
// same moment can both still see the other as unsigned; the sweep job repeats this check.
export async function advanceIfAllSigned(
  ctx: { readonly db: TenantDb },
  user: SessionUser,
  requestId: string,
): Promise<boolean> {
  const signers = await listSigners(ctx, user, requestId);
  const allSigned =
    signers.length > 0 &&
    signers.every((signer) => signer.status === SIGNATURE_SIGNER_STATUS.Signed);
  if (!allSigned) return false;
  const moved = await setRequestStatus(ctx, user, requestId, SIGNATURE_REQUEST_STATUS.Open, {
    status: SIGNATURE_REQUEST_STATUS.AllSigned,
  });
  return moved.isSuccess;
}

export function loadRequestOfSigner(
  ctx: { readonly db: TenantDb },
  user: SessionUser,
  signer: SignerRow,
) {
  return requestExecutor.detail({ id: signer.requestId }, user, ctx.db);
}

// Each outcome is its own aggregate with a fresh id: it needs no predecessor version and cannot
// conflict with a concurrent write on the request it describes.
export function appendOutcomeEvent(
  ctx: Pick<HandlerContext, "events">,
  type: string,
  payload: Readonly<Record<string, unknown>>,
) {
  return ctx.events.unsafeAppend({
    aggregateId: generateId(),
    aggregateType: SIGNATURE_OUTCOME_AGGREGATE_TYPE,
    type,
    payload,
  });
}
