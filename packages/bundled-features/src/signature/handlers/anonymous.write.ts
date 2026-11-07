import {
  createSystemUser,
  defineWriteHandler,
  type HandlerContext,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import type { RateLimitDeclaration } from "@cosmicdrift/kumiko-types/handlers";
import { peekSignatureLinkSubject } from "../grant.ts";
import { invalidLink } from "../lib.ts";
import { DeclineByLinkSchema, OpenByLinkSchema, SignByLinkSchema } from "../payloads.ts";
import { decodeSignatureImage, invalidImage } from "../signing.ts";
import { SignatureInternalHandlers } from "../web/constants.ts";

const TENANT_SWITCH_REASON =
  "the link holder arrives anonymously in the default tenant while the signer lives in the request's tenant; the tenant comes from the signed link subject and the internal handler verifies the grant there via ctx.dispatch.writeAs";

// One answer for every rejection, so a caller cannot tell forged from expired, revoked, used up or already signed.
async function forwardIntoLinkTenant(
  ctx: Pick<HandlerContext, "dispatch">,
  token: string,
  qn: string,
  payload: unknown,
): Promise<WriteResult> {
  const subject = peekSignatureLinkSubject(token);
  if (subject === null) return invalidLink();
  const result = await ctx.dispatch.writeAs(createSystemUser(subject.tenantId), qn, payload);
  return result.isSuccess ? result : invalidLink();
}

export function createAnonymousLinkHandlers(rateLimit: RateLimitDeclaration) {
  const openByLink = defineWriteHandler({
    name: "open-by-link",
    schema: OpenByLinkSchema,
    access: { roles: ["anonymous"], anySignedIn: true },
    rateLimit,
    escapeHatch: { grants: ["systemIdentity"], reason: TENANT_SWITCH_REASON },
    agent: { expose: false },
    description:
      "Anonymous: opens a signing link and returns the title, the signer's name and role and a short-lived document URL. Does not consume the link, counts the view up to a limit.",
    handler: (event, ctx) =>
      forwardIntoLinkTenant(
        ctx,
        event.payload.token,
        SignatureInternalHandlers.linkOpen,
        event.payload,
      ),
  });

  const signByLink = defineWriteHandler({
    name: "sign-by-link",
    schema: SignByLinkSchema,
    access: { roles: ["anonymous"], personalData: "public-intake", anySignedIn: true },
    rateLimit,
    escapeHatch: { grants: ["systemIdentity"], reason: TENANT_SWITCH_REASON },
    agent: { expose: false },
    description:
      "Anonymous: signs through a link with a drawn PNG signature, exactly once; the link is consumed by the signature.",
    handler: async (event, ctx) => {
      if (decodeSignatureImage(event.payload.imagePngBase64) === null) return invalidImage();
      return forwardIntoLinkTenant(
        ctx,
        event.payload.token,
        SignatureInternalHandlers.linkSign,
        event.payload,
      );
    },
  });

  const declineByLink = defineWriteHandler({
    name: "decline-by-link",
    schema: DeclineByLinkSchema,
    access: { roles: ["anonymous"], personalData: "public-intake", anySignedIn: true },
    rateLimit,
    escapeHatch: { grants: ["systemIdentity"], reason: TENANT_SWITCH_REASON },
    agent: { expose: false },
    description:
      "Anonymous: declines to sign through a link with an optional reason; the request becomes declined and every link of it stops working.",
    handler: (event, ctx) =>
      forwardIntoLinkTenant(
        ctx,
        event.payload.token,
        SignatureInternalHandlers.linkDecline,
        event.payload,
      ),
  });

  return { openByLink, signByLink, declineByLink };
}
