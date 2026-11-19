import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { type SignatureRequestExecutor, signerExecutor } from "../entity.ts";
import { loadRequestOfSigner, requestHostIsVisible } from "../lib.ts";
import { SignerIdSchema } from "../payloads.ts";

export function createRevokeLinkHandler(
  access: AccessRule,
  requestExecutor: SignatureRequestExecutor,
) {
  return defineWriteHandler<"revoke-link", typeof SignerIdSchema, { readonly revoked: true }>({
    name: "revoke-link",
    schema: SignerIdSchema,
    access,
    agent: { expose: false },
    description: "Revokes the signing link of one signer; the token stops working at once.",
    handler: async (event, ctx) => {
      const signer = await signerExecutor.detail(
        { id: event.payload.signerId },
        event.user,
        ctx.db,
      );
      const request =
        signer === null
          ? null
          : await loadRequestOfSigner(requestExecutor, ctx, event.user, signer);
      if (request === null || !(await requestHostIsVisible(ctx, event.user, request))) {
        return writeFailure(new NotFoundError("signer", event.payload.signerId));
      }
      const updated = await signerExecutor.update(
        { id: event.payload.signerId, changes: { linkAnchor: null } },
        event.user,
        ctx.db,
        { skipOptimisticLock: true },
      );
      if (!updated.isSuccess) return updated;
      return { isSuccess: true, data: { revoked: true } };
    },
  });
}
