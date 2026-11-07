import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { signerExecutor } from "../entity.ts";
import { SignerIdSchema } from "../payloads.ts";

export function createRevokeLinkHandler(access: AccessRule) {
  return defineWriteHandler<"revoke-link", typeof SignerIdSchema, { readonly revoked: true }>({
    name: "revoke-link",
    schema: SignerIdSchema,
    access,
    agent: { expose: false },
    description: "Revokes the signing link of one signer; the token stops working at once.",
    handler: async (event, ctx) => {
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
