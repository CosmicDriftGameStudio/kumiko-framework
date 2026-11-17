import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { type SignatureRequestExecutor, signerExecutor } from "../entity.ts";
import { loadRequestOfSigner, requestHostIsVisible } from "../lib.ts";
import { SignerIdSchema } from "../payloads.ts";
import { eraseSignerRows, signerEraseContext } from "../user-data.ts";

export function createForgetSignerHandler(requestExecutor: SignatureRequestExecutor) {
  return defineWriteHandler<"forget-signer", typeof SignerIdSchema, { readonly forgotten: true }>({
    name: "forget-signer",
    schema: SignerIdSchema,
    access: { roles: [ROLES.TenantAdmin, ROLES.DataProtectionOfficer] },
    agent: { risk: "high" },
    description:
      "Erases one signer's personal data on request (Art. 17 GDPR), for people without an account: removes the signer row, the signature image and the signer's record key, and cancels the request while it is still open or all-signed.",
    handler: async (event, ctx) => {
      const user = event.user;
      const signer = await signerExecutor.detail({ id: event.payload.signerId }, user, ctx.db);
      const request =
        signer === null ? null : await loadRequestOfSigner(requestExecutor, ctx, user, signer);
      if (signer === null || request === null || !(await requestHostIsVisible(ctx, user, request))) {
        return writeFailure(new NotFoundError("signer", event.payload.signerId));
      }
      await eraseSignerRows(signerEraseContext(ctx, user), [signer], "delete");
      return { isSuccess: true, data: { forgotten: true } };
    },
  });
}
