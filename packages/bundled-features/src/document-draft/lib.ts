import {
  type AccessRule,
  access,
  type HandlerContext,
  hasAccess,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  VersionConflictError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { joinRowParentIsVisible } from "../shared/index.ts";
import {
  type PdfTemplateMeta,
  parseTemplateMeta,
  readPdfTemplateMeta,
} from "../template-resolver/index.ts";
import type { DocumentDraftExecutor } from "./entity.ts";
import {
  DOCUMENT_DRAFT_ENTITY,
  DOCUMENT_DRAFT_ERROR,
  DOCUMENT_DRAFT_STATUS,
  type DocumentDraftStatus,
} from "./web/constants.ts";

export const DEFAULT_DOCUMENT_DRAFT_ACCESS: AccessRule = { roles: access.tenantMembers };

export type SubjectAccess = Readonly<Record<string, AccessRule>>;

// A subject type without its own rule is governed by the feature-wide access only.
export function subjectRoleAllows(
  subjectAccess: SubjectAccess,
  user: SessionUser,
  subjectType: string,
): boolean {
  const rule = Object.hasOwn(subjectAccess, subjectType) ? subjectAccess[subjectType] : undefined;
  return rule === undefined || hasAccess(user, rule);
}

export type DraftRow = NonNullable<Awaited<ReturnType<DocumentDraftExecutor["detail"]>>>;

export function draftNotFound(id?: string) {
  return writeFailure(new NotFoundError(DOCUMENT_DRAFT_ENTITY, id));
}

/** The role rule of the subject type and the user's read access to the subject itself; a miss is reported as not found. */
export async function subjectIsReachable(
  ctx: Pick<HandlerContext, "db" | "registry">,
  user: SessionUser,
  subject: { readonly subjectType: string; readonly subjectId: string },
  subjectAccess: SubjectAccess,
): Promise<boolean> {
  if (!subjectRoleAllows(subjectAccess, user, subject.subjectType)) return false;
  return joinRowParentIsVisible(ctx.registry, DOCUMENT_DRAFT_ENTITY, subject, user, ctx.db);
}

// A draft of another tenant, an unknown id, a subject the user may not read and a subject type whose role rule they miss all answer the same.
export async function loadScopedDraft(
  documentDraftExecutor: DocumentDraftExecutor,
  ctx: Pick<HandlerContext, "db" | "registry">,
  user: SessionUser,
  id: string,
  subjectAccess: SubjectAccess,
): Promise<DraftRow | null> {
  const row = await documentDraftExecutor.detail({ id }, user, ctx.db);
  if (row === null) return null;
  if (!subjectRoleAllows(subjectAccess, user, String(row.subjectType))) return null;
  const subjectIsVisible = await joinRowParentIsVisible(
    ctx.registry,
    DOCUMENT_DRAFT_ENTITY,
    { subjectType: row.subjectType, subjectId: row.subjectId },
    user,
    ctx.db,
  );
  return subjectIsVisible ? row : null;
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

export function notFinalizable() {
  return writeFailure(
    new UnprocessableError(DOCUMENT_DRAFT_ERROR.NotFinalizable, {
      i18nKey: "documentDraft.errors.notFinalizable",
    }),
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
