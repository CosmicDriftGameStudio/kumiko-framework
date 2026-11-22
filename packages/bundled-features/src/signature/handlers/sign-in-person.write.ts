import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { discardGeneratedFile } from "../../file-foundation/index.ts";
import { type SignatureRequestExecutor, signerExecutor } from "../entity.ts";
import {
  advanceIfAllSigned,
  isOpenRequest,
  isUnsignedSigner,
  loadRequestOfSigner,
  requestHostIsVisible,
} from "../lib.ts";
import { SignInPersonSchema } from "../payloads.ts";
import {
  decodeSignatureImage,
  invalidImage,
  recordInPersonSignature,
  storeSignatureImage,
} from "../signing.ts";
import { SIGNATURE_METHOD, SIGNATURE_REQUEST_STATUS } from "../web/constants.ts";

export type SignInPersonData = { readonly requestStatus: string };

export function createSignInPersonHandler(
  access: AccessRule,
  requestExecutor: SignatureRequestExecutor,
) {
  return defineWriteHandler<"sign-in-person", typeof SignInPersonSchema, SignInPersonData>({
    name: "sign-in-person",
    schema: SignInPersonSchema,
    access,
    agent: { expose: false },
    description:
      "Records the signature a person drew on this display for one signer of an open request; the last signature moves the request to all-signed.",
    handler: async (event, ctx) => {
      const user = event.user;
      const signer = await signerExecutor.detail({ id: event.payload.signerId }, user, ctx.db);
      if (signer === null) return writeFailure(new NotFoundError("signer", event.payload.signerId));
      const request = await loadRequestOfSigner(requestExecutor, ctx, user, signer);
      if (request !== null && !(await requestHostIsVisible(ctx, user, request))) {
        return writeFailure(new NotFoundError("signer", event.payload.signerId));
      }
      const now = ctx.tz.now();
      if (request === null || !isOpenRequest(request, now) || !isUnsignedSigner(signer)) {
        return writeFailure(new UnprocessableError("signature_not_possible"));
      }
      const png = decodeSignatureImage(event.payload.imagePngBase64);
      if (png === null) return invalidImage();

      const image = await storeSignatureImage(ctx, user, png);
      if (!image.isSuccess) return image;
      const recorded = await recordInPersonSignature(ctx, user, signer, {
        method: SIGNATURE_METHOD.InPerson,
        imageFileId: image.data.id,
        signedAt: now,
      });
      if (!recorded.isSuccess) {
        await discardGeneratedFile(ctx, user, image.data);
        return recorded;
      }

      const allSigned = await advanceIfAllSigned(requestExecutor, ctx, user, request.id);
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
}
