import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { signerExecutor } from "../entity.ts";
import { signSignatureLinkToken } from "../grant.ts";
import { isOpenRequest, isUnsignedSigner, loadRequestOfSigner } from "../lib.ts";
import type { SignatureOptions } from "../options.ts";
import { SignerIdSchema } from "../payloads.ts";
import type { SubjectScope } from "../subject-scope.ts";

export type IssueLinkData = { readonly signerId: string; readonly linkSentAt: string };

// A new link replaces the previous one: the anchor moves on, so the old token stops verifying.
export function createIssueLinkHandler(
  access: AccessRule,
  scope: SubjectScope,
  opts: Pick<SignatureOptions, "linkSecret" | "deliverLink" | "signaturePageUrl">,
) {
  return defineWriteHandler<"issue-link", typeof SignerIdSchema, IssueLinkData>({
    name: "issue-link",
    schema: SignerIdSchema,
    access,
    agent: { risk: "mid" },
    description:
      "Sends a signing link to one signer of an open request, to the signer's own address; the link is never part of the result. An earlier link of that signer stops working. The link is valid for 14 days and a limited number of opens.",
    handler: async (event, ctx) => {
      const user = event.user;
      const signer = await signerExecutor.detail({ id: event.payload.signerId }, user, ctx.db);
      if (signer === null) return writeFailure(new NotFoundError("signer", event.payload.signerId));
      const request = await loadRequestOfSigner(ctx, user, signer);
      if (request !== null && !(await scope.allowsRequest(ctx, user, request))) {
        return writeFailure(new NotFoundError("signer", event.payload.signerId));
      }
      const now = ctx.tz.now();
      if (request === null || !isOpenRequest(request, now) || !isUnsignedSigner(signer)) {
        return writeFailure(new UnprocessableError("link_not_possible"));
      }
      if (typeof signer.email !== "string" || signer.email === "") {
        return writeFailure(new UnprocessableError("signer_without_email"));
      }
      const linkAnchor = generateId();
      const updated = await signerExecutor.update(
        {
          id: signer.id,
          changes: { linkAnchor, linkSentAt: now, viewCount: 0 },
        },
        user,
        ctx.db,
        { skipOptimisticLock: true },
      );
      if (!updated.isSuccess) return updated;
      const grant = signSignatureLinkToken({
        tenantId: user.tenantId,
        signerId: signer.id,
        linkAnchor,
        secret: opts.linkSecret,
        now,
      });
      await opts.deliverLink(ctx, {
        signerId: String(signer.id),
        requestId: String(request.id),
        name: signer.name,
        email: signer.email,
        url: `${opts.signaturePageUrl}#${grant.token}`,
        issuedBy: user,
      });
      return {
        isSuccess: true,
        data: { signerId: String(signer.id), linkSentAt: now.toString() },
      };
    },
  });
}
