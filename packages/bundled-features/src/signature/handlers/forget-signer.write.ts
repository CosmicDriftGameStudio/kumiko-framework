import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { SubjectScope } from "../../shared/index.ts";
import { signerExecutor } from "../entity.ts";
import { loadRequestOfSigner } from "../lib.ts";
import { SignerIdSchema } from "../payloads.ts";
import { eraseSignerRows, signerEraseContext } from "../user-data.ts";

export function createForgetSignerHandler(scope: SubjectScope) {
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
      if (signer === null) return writeFailure(new NotFoundError("signer", event.payload.signerId));
      const request = await loadRequestOfSigner(ctx, user, signer);
      if (request !== null && !(await scope.allowsRequest(ctx, user, request))) {
        return writeFailure(new NotFoundError("signer", event.payload.signerId));
      }
      await eraseSignerRows(signerEraseContext(ctx, user), [signer], "delete");
      return { isSuccess: true, data: { forgotten: true } };
    },
  });
}
