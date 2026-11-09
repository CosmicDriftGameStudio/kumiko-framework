import {
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { createSignatureRequestEntity, createSignatureSignerEntity } from "./entity.ts";
import { createAnonymousLinkHandlers } from "./handlers/anonymous.write.ts";
import { createCancelHandler } from "./handlers/cancel.write.ts";
import { createIssueLinkHandler } from "./handlers/issue-link.write.ts";
import { expireHandler, finishHandler, reconcileHandler } from "./handlers/lifecycle.write.ts";
import { createLinkInternalHandlers } from "./handlers/link-internal.write.ts";
import { createRequestHandler } from "./handlers/request.write.ts";
import { createRevokeLinkHandler } from "./handlers/revoke-link.write.ts";
import { createSignInPersonHandler } from "./handlers/sign-in-person.write.ts";
import { SIGNATURE_I18N } from "./i18n.ts";
import { DEFAULT_SIGNATURE_ACCESS } from "./lib.ts";
import { LINK_RATE_LIMIT, type SignatureOptions } from "./options.ts";
import {
  SignatureCompletedEventSchema,
  SignatureDeclinedEventSchema,
  SignatureExpiredEventSchema,
} from "./payloads.ts";
import { createSignatureDetailScreen, createSignatureListScreen } from "./screens.ts";
import { scopeRequestDetail, scopeRequestList, scopeSignerList } from "./subject-queries.ts";
import { createSubjectScope } from "./subject-scope.ts";
import { sweepSignatureRequests } from "./sweep.ts";
import { signatureDeleteHook, signatureExportHook } from "./user-data.ts";
import {
  SIGNATURE_FEATURE,
  SIGNATURE_REQUEST_ENTITY,
  SIGNATURE_SIGNER_ENTITY,
} from "./web/constants.ts";

export function createSignatureFeature(opts: SignatureOptions): FeatureDefinition {
  if (opts.authorizeSubject !== undefined && opts.linkSecret === "") {
    throw new Error("authorizeSubject needs a non-empty linkSecret: it also seals the list cursor");
  }
  const signedInAccess = opts.access ?? DEFAULT_SIGNATURE_ACCESS;
  const scope = createSubjectScope(opts);
  const requestEntity = createSignatureRequestEntity(opts.retention);
  const signerEntity = createSignatureSignerEntity(opts.retention);
  const anonymous = createAnonymousLinkHandlers(LINK_RATE_LIMIT);
  const link = createLinkInternalHandlers(opts.linkSecret);

  return defineFeature(SIGNATURE_FEATURE, (r) => {
    r.describe(
      "Signature requests: a signed-in user asks several people to sign one PDF of the tenant. Each signer draws a signature on a display in person or through a link in the URL fragment (14 days, limited opens, revocable, single-use, one answer for every rejection). The last signature moves the request to all-signed; a job renders a signature page through the injected print function, appends it to the unchanged original and completes the request. Events completed, declined and expired report the outcome; signer name, email, image, IP and user agent are personal data.",
    );
    r.uiHints({ displayLabel: "Signatures", category: "data", recommended: false });
    r.requires({ features: ["files", "user-data-rights"] });
    r.adoptsBundledLists();
    r.translations({ keys: SIGNATURE_I18N });

    r.entity({ name: "signatureRequest", ...requestEntity });
    r.entity({ name: "signatureSigner", ...signerEntity });

    r.defineEvent("completed", SignatureCompletedEventSchema, {
      piiFields: "none",
    });
    r.defineEvent("declined", SignatureDeclinedEventSchema, {
      piiFields: "none",
    });
    r.defineEvent("expired", SignatureExpiredEventSchema, {
      piiFields: "none",
    });

    r.writeHandler(createRequestHandler(signedInAccess, scope));
    r.writeHandler(createSignInPersonHandler(signedInAccess, scope));
    r.writeHandler(createIssueLinkHandler(signedInAccess, scope, opts));
    r.writeHandler(createRevokeLinkHandler(signedInAccess, scope));
    r.writeHandler(createCancelHandler(signedInAccess, scope));
    r.writeHandler(anonymous.openByLink);
    r.writeHandler(anonymous.signByLink);
    r.writeHandler(anonymous.declineByLink);
    r.writeHandler(link.linkOpen);
    r.writeHandler(link.linkSign);
    r.writeHandler(link.linkDecline);
    r.writeHandler(finishHandler);
    r.writeHandler(expireHandler);
    r.writeHandler(reconcileHandler);

    const requestList = defineEntityListHandler(SIGNATURE_REQUEST_ENTITY, requestEntity, {
      access: signedInAccess,
      description:
        "Lists signature requests with status, deadline and the object they belong to; paging, search over the title and sorting.",
    });
    const requestDetail = defineEntityDetailHandler(SIGNATURE_REQUEST_ENTITY, requestEntity, {
      access: signedInAccess,
      description: "Returns one signature request.",
    });
    const signerList = defineEntityListHandler(SIGNATURE_SIGNER_ENTITY, signerEntity, {
      access: signedInAccess,
      agent: { expose: false },
      description:
        "Lists the signers of requests with their status and way of signing; carries the signers' personal data.",
    });
    r.queryHandler(scopeRequestList(requestList, scope, opts.linkSecret));
    r.queryHandler(scopeRequestDetail(requestDetail, scope));
    r.queryHandler(scopeSignerList(signerList, scope));

    r.useExtension(EXT_USER_DATA, SIGNATURE_SIGNER_ENTITY, {
      export: signatureExportHook,
      delete: signatureDeleteHook,
    });

    r.job({
      name: "sweep",
      trigger: { cron: "*/5 * * * *" },
      perTenant: true,
      concurrency: "skip",
      handler: (_payload, ctx) => sweepSignatureRequests(ctx, opts),
    });

    r.screen(createSignatureListScreen(signedInAccess));
    r.screen(createSignatureDetailScreen(signedInAccess));
    r.nav({
      id: "signature",
      label: i18nKey("signature.nav.signature"),
      screen: "signature:screen:signature-list",
      icon: "file",
      order: 40,
      access: signedInAccess,
    });
  });
}
