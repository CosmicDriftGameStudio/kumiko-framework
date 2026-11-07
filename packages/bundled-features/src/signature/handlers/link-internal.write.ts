import {
  defineWriteHandler,
  type HandlerContext,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signerExecutor } from "../entity.ts";
import { discardGeneratedFile, signedDocumentUrl } from "../files.ts";
import { parseSignatureLinkSubject, redeemSignatureLinkToken } from "../grant.ts";
import {
  advanceIfAllSigned,
  appendOutcomeEvent,
  internalAccess,
  invalidLink,
  isOpenRequest,
  isUnsignedSigner,
  loadRequestOfSigner,
  type RequestRow,
  type SignerRow,
  setRequestStatus,
} from "../lib.ts";
import { DeclineByLinkSchema, OpenByLinkSchema, SignByLinkSchema } from "../payloads.ts";
import {
  auditValuesOfRequest,
  decodeSignatureImage,
  invalidImage,
  signatureChanges,
  storeSignatureImage,
} from "../signing.ts";
import {
  SIGNATURE_MAX_LINK_OPENS,
  SIGNATURE_METHOD,
  SIGNATURE_REQUEST_STATUS,
  SIGNATURE_SIGNER_STATUS,
  SignatureEvents,
} from "../web/constants.ts";

export type LinkOpenData = {
  readonly title: string;
  readonly signerName: string;
  readonly role: string | null;
  readonly documentUrl: string | null;
};

type LinkTarget = { readonly signer: SignerRow; readonly request: RequestRow };

const NO_CONSUME_REASON =
  "opening a link only shows the document and counts the view; signing and declining consume the link";

// Anchor of a signer whose link may still act: unsigned, request open, link not revoked.
async function loadLiveTarget(
  ctx: Pick<HandlerContext, "db">,
  user: SessionUser,
  signerId: string,
  now: Temporal.Instant,
): Promise<LinkTarget | null> {
  const signer = await signerExecutor.detail({ id: signerId }, user, ctx.db);
  if (signer === null || !isUnsignedSigner(signer) || typeof signer.linkAnchor !== "string") {
    return null;
  }
  const request = await loadRequestOfSigner(ctx, user, signer);
  return request !== null && isOpenRequest(request, now) ? { signer, request } : null;
}

function viewCountOf(signer: SignerRow): number {
  return typeof signer.viewCount === "number" ? signer.viewCount : 0;
}

function viewChanges(signer: SignerRow, now: Temporal.Instant): Record<string, unknown> {
  return {
    viewCount: viewCountOf(signer) + 1,
    viewedAt: now,
    ...(signer.status === SIGNATURE_SIGNER_STATUS.Pending && {
      status: SIGNATURE_SIGNER_STATUS.Viewed,
    }),
  };
}

export function createLinkInternalHandlers(linkSecret: string) {
  const linkOpen = defineWriteHandler<"link-open", typeof OpenByLinkSchema, LinkOpenData>({
    name: "link-open",
    schema: OpenByLinkSchema,
    access: internalAccess,
    agent: { expose: false },
    description:
      "Internal: verifies a signing link inside the request's tenant, counts the view and returns what the signing page shows. Reached only through open-by-link.",
    handler: async (event, ctx) => {
      const user = event.user;
      const now = ctx.tz.now();
      const found: { target: LinkTarget | null } = { target: null };
      const redeemed = await redeemSignatureLinkToken({
        token: event.payload.token,
        secret: linkSecret,
        now,
        loadLinkAnchor: async (signerId) => {
          const target = await loadLiveTarget(ctx, user, signerId, now);
          if (target === null || viewCountOf(target.signer) >= SIGNATURE_MAX_LINK_OPENS)
            return null;
          found.target = target;
          return typeof target.signer.linkAnchor === "string" ? target.signer.linkAnchor : null;
        },
        commitAnchor: { unsafeSkip: { reason: NO_CONSUME_REASON } },
      });
      const target = found.target;
      if (!redeemed.ok || target === null) return invalidLink();

      // A concurrent sign must never be overwritten by the view count, and two simultaneous opens
      // must not both pass the open limit, so status and view count are preconditions.
      const counted = await signerExecutor.update(
        { id: target.signer.id, changes: viewChanges(target.signer, now) },
        user,
        ctx.db,
        {
          skipOptimisticLock: true,
          expect: { status: target.signer.status, viewCount: viewCountOf(target.signer) },
        },
      );
      if (!counted.isSuccess) return invalidLink();
      return {
        isSuccess: true,
        data: {
          title: target.request.title,
          signerName: target.signer.name,
          role: target.signer.role ?? null,
          documentUrl: await signedDocumentUrl(ctx, user, target.request.documentFileId),
        },
      };
    },
  });

  const linkSign = defineWriteHandler<
    "link-sign",
    typeof SignByLinkSchema,
    { readonly requestStatus: string }
  >({
    name: "link-sign",
    schema: SignByLinkSchema,
    access: internalAccess,
    agent: { expose: false },
    description:
      "Internal: verifies a signing link inside the request's tenant and records the signature exactly once; of two simultaneous submits one wins. Reached only through sign-by-link.",
    handler: async (event, ctx) => {
      const user = event.user;
      const now = ctx.tz.now();
      const png = decodeSignatureImage(event.payload.imagePngBase64);
      if (png === null) return invalidImage();
      const found: { target: LinkTarget | null } = { target: null };
      const redeemed = await redeemSignatureLinkToken({
        token: event.payload.token,
        secret: linkSecret,
        now,
        loadLinkAnchor: async (signerId) => {
          found.target = await loadLiveTarget(ctx, user, signerId, now);
          const anchor = found.target?.signer.linkAnchor;
          return typeof anchor === "string" ? anchor : null;
        },
        // Spends the anchor and writes the signature in one conditional update, so exactly one of
        // two simultaneous submits passes.
        commitAnchor: async (subject, expectedAnchor) => {
          const parsed = parseSignatureLinkSubject(subject);
          if (parsed === null) return false;
          const image = await storeSignatureImage(ctx, user, png);
          if (!image.isSuccess) return false;
          const signed = await signerExecutor.update(
            {
              id: parsed.signerId,
              changes: signatureChanges({
                method: SIGNATURE_METHOD.Link,
                imageFileId: image.data.id,
                signedAt: now,
              }),
            },
            user,
            ctx.db,
            { skipOptimisticLock: true, expect: { linkAnchor: expectedAnchor } },
          );
          if (!signed.isSuccess) await discardGeneratedFile(ctx, user, image.data);
          return signed.isSuccess;
        },
      });
      const target = found.target;
      if (!redeemed.ok || target === null) return invalidLink();
      const allSigned = await advanceIfAllSigned(ctx, user, target.request.id);
      return {
        isSuccess: true,
        data: {
          requestStatus: allSigned
            ? SIGNATURE_REQUEST_STATUS.AllSigned
            : SIGNATURE_REQUEST_STATUS.Open,
        },
      };
    },
  });

  const linkDecline = defineWriteHandler<
    "link-decline",
    typeof DeclineByLinkSchema,
    { readonly declined: true }
  >({
    name: "link-decline",
    schema: DeclineByLinkSchema,
    access: internalAccess,
    agent: { expose: false },
    description:
      "Internal: verifies a signing link inside the request's tenant, records the refusal exactly once and moves the request to declined. Reached only through decline-by-link.",
    handler: async (event, ctx) => {
      const user = event.user;
      const now = ctx.tz.now();
      const found: { target: LinkTarget | null } = { target: null };
      const redeemed = await redeemSignatureLinkToken({
        token: event.payload.token,
        secret: linkSecret,
        now,
        loadLinkAnchor: async (signerId) => {
          found.target = await loadLiveTarget(ctx, user, signerId, now);
          const anchor = found.target?.signer.linkAnchor;
          return typeof anchor === "string" ? anchor : null;
        },
        commitAnchor: async (subject, expectedAnchor) => {
          const parsed = parseSignatureLinkSubject(subject);
          if (parsed === null) return false;
          const declined = await signerExecutor.update(
            {
              id: parsed.signerId,
              changes: {
                status: SIGNATURE_SIGNER_STATUS.Declined,
                linkAnchor: null,
                ...(event.payload.reason !== undefined && { declineReason: event.payload.reason }),
                ...auditValuesOfRequest(),
              },
            },
            user,
            ctx.db,
            { skipOptimisticLock: true, expect: { linkAnchor: expectedAnchor } },
          );
          return declined.isSuccess;
        },
      });
      const target = found.target;
      if (!redeemed.ok || target === null) return invalidLink();
      const moved = await setRequestStatus(
        ctx,
        user,
        target.request.id,
        SIGNATURE_REQUEST_STATUS.Open,
        { status: SIGNATURE_REQUEST_STATUS.Declined },
      );
      if (moved.isSuccess) {
        await appendOutcomeEvent(ctx, SignatureEvents.declined, {
          requestId: target.request.id,
          subjectType: target.request.subjectType,
          subjectId: target.request.subjectId,
          signerId: target.signer.id,
        });
      }
      return { isSuccess: true, data: { declined: true } };
    },
  });

  return { linkOpen, linkSign, linkDecline };
}
