import {
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { computeCutoff } from "../data-retention/index.ts";
import {
  createSignatureRequestEntity,
  createSignatureRequestExecutor,
  createSignatureSignerEntity,
} from "./entity.ts";
import { eraseSignersOfUnfinishedRequests } from "./erase-unfinished.ts";
import { createAnonymousLinkHandlers } from "./handlers/anonymous.write.ts";
import { createCancelHandler } from "./handlers/cancel.write.ts";
import { createForgetSignerHandler } from "./handlers/forget-signer.write.ts";
import { createIssueLinkHandler } from "./handlers/issue-link.write.ts";
import {
  createExpireHandler,
  createFailHandler,
  createFinishHandler,
  createReconcileHandler,
} from "./handlers/lifecycle.write.ts";
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
  SignatureFailedEventSchema,
} from "./payloads.ts";
import { gateSignerListByRequestHost } from "./signer-list-gate.ts";
import { createSignatureDetailScreen, createSignatureListScreen } from "./screens.ts";
import { sweepSignatureRequests } from "./sweep.ts";
import { signatureDeleteHook, signatureExportHook } from "./user-data.ts";
import {
  SIGNATURE_FEATURE,
  SIGNATURE_REQUEST_ENTITY,
  SIGNATURE_SIGNER_ENTITY,
} from "./web/constants.ts";

export function createSignatureFeature(opts: SignatureOptions): FeatureDefinition {
  // Fails the boot on a malformed spec instead of the first nightly run; the instant is irrelevant.
  computeCutoff(opts.retention.unfinishedKeepFor, Temporal.Instant.fromEpochMilliseconds(0));
  const signedInAccess = opts.access ?? DEFAULT_SIGNATURE_ACCESS;
  const requestEntity = createSignatureRequestEntity(opts.retention, opts.hostEntities);
  const requestExecutor = createSignatureRequestExecutor(opts.hostEntities);
  const signerEntity = createSignatureSignerEntity(opts.retention);
  const anonymous = createAnonymousLinkHandlers(LINK_RATE_LIMIT, opts.linkSecret);
  const link = createLinkInternalHandlers(opts.linkSecret, requestExecutor);

  return defineFeature(SIGNATURE_FEATURE, (r) => {
    r.describe(
      "Signature requests: a signed-in user asks several people to sign one PDF of the tenant. Every request belongs to a host row of an entity named in `hostEntities`; a user sees and works on a request only while that row is readable to them. Each signer draws a signature on a display in person or through a link in the URL fragment (14 days, limited opens, revocable, single-use, one answer for every rejection). The last signature moves the request to all-signed; a job renders a signature page through the print client, appends it to the unchanged original and completes the request. Events completed, declined, expired and failed report the outcome; signer name, email, image, IP and user agent are personal data.",
    );
    r.uiHints({ displayLabel: "Signatures", category: "data", recommended: false });
    r.requires({ features: ["files", "user-data-rights", "renderer-puppeteer-client"] });
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
    r.defineEvent("failed", SignatureFailedEventSchema, {
      piiFields: "none",
    });

    r.writeHandler(createRequestHandler(signedInAccess, requestExecutor));
    r.writeHandler(createSignInPersonHandler(signedInAccess, requestExecutor));
    r.writeHandler(createIssueLinkHandler(signedInAccess, requestExecutor, opts));
    r.writeHandler(createRevokeLinkHandler(signedInAccess, requestExecutor));
    r.writeHandler(createCancelHandler(signedInAccess, requestExecutor));
    r.writeHandler(createForgetSignerHandler(requestExecutor));
    r.writeHandler(anonymous.openByLink);
    r.writeHandler(anonymous.signByLink);
    r.writeHandler(anonymous.declineByLink);
    r.writeHandler(link.linkOpen);
    r.writeHandler(link.linkSign);
    r.writeHandler(link.linkDecline);
    r.writeHandler(createFinishHandler(requestExecutor));
    r.writeHandler(createExpireHandler(requestExecutor));
    r.writeHandler(createFailHandler(requestExecutor));
    r.writeHandler(createReconcileHandler(requestExecutor));

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
    r.queryHandler(requestList);
    r.queryHandler(requestDetail);
    r.queryHandler(gateSignerListByRequestHost(signerList, requestExecutor));

    r.useExtension(EXT_USER_DATA, SIGNATURE_SIGNER_ENTITY, {
      export: signatureExportHook,
      delete: signatureDeleteHook,
    });

    r.job({
      name: "sweep",
      trigger: { cron: "*/5 * * * *" },
      perTenant: true,
      concurrency: "skip",
      handler: (_payload, ctx) => sweepSignatureRequests(ctx),
    });

    r.job({
      name: "erase-unfinished-signers",
      trigger: { cron: "17 3 * * *" },
      perTenant: true,
      concurrency: "skip",
      handler: (_payload, ctx) => eraseSignersOfUnfinishedRequests(ctx, opts.retention),
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
