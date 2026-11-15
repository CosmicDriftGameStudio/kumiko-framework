import type { AccessRule, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  VersionConflictError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { SubjectScope, SubjectScopeContext } from "../shared/index.ts";
import {
  type PdfTemplateMeta,
  parseTemplateMeta,
  readPdfTemplateMeta,
} from "../template-resolver/index.ts";
import { documentDraftExecutor } from "./entity.ts";
import {
  DOCUMENT_DRAFT_ENTITY,
  DOCUMENT_DRAFT_ERROR,
  DOCUMENT_DRAFT_STATUS,
  type DocumentDraftStatus,
} from "./web/constants.ts";

export const DEFAULT_DOCUMENT_DRAFT_ACCESS: AccessRule = { roles: ["TenantAdmin", "TenantMember"] };

export type DraftRow = NonNullable<Awaited<ReturnType<typeof documentDraftExecutor.detail>>>;

export function draftNotFound(id?: string) {
  return writeFailure(new NotFoundError(DOCUMENT_DRAFT_ENTITY, id));
}

// A draft of another tenant, an unknown id and a subject the user may not see all answer the same.
export async function loadScopedDraft(
  ctx: SubjectScopeContext,
  user: SessionUser,
  scope: SubjectScope,
  id: string,
): Promise<DraftRow | null> {
  const row = await documentDraftExecutor.detail({ id }, user, ctx.db);
  if (row === null || !(await scope.allowsRequest(ctx, user, row))) return null;
  return row;
}

export function notInStatus(expected: DocumentDraftStatus) {
  const open = expected === DOCUMENT_DRAFT_STATUS.Open;
  return writeFailure(
    new UnprocessableError(
      open ? DOCUMENT_DRAFT_ERROR.NotOpen : DOCUMENT_DRAFT_ERROR.NotFinalized,
      {
        i18nKey: open ? "documentDraft.errors.notOpen" : "documentDraft.errors.notFinalized",
      },
    ),
  );
}

// Null when the draft is open at the version the caller read; otherwise the failure to return.
export function checkOpenAtBase(draft: DraftRow, id: string, base: number) {
  if (draft.status !== DOCUMENT_DRAFT_STATUS.Open) return notInStatus(DOCUMENT_DRAFT_STATUS.Open);
  if (draft.version !== base) {
    return writeFailure(
      new VersionConflictError({
        entityId: id,
        expectedVersion: base,
        currentVersion: Number(draft.version),
      }),
    );
  }
  return null;
}

export function recordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
  return isPlainObject(value) ? value : {};
}

export function pdfMetaOf(raw: unknown): PdfTemplateMeta | null {
  const parsed = parseTemplateMeta("document-pdf", raw);
  return parsed.ok ? readPdfTemplateMeta(parsed.meta) : null;
}
