import type { AccessRule, HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { RateLimitDeclaration } from "@cosmicdrift/kumiko-types/handlers";
import type { PdfOptions } from "../renderer-foundation/index.ts";
import type { SignatureRetention } from "./entity.ts";

// Injected by the app (renderer-puppeteer-client's `renderHtmlToPdf`): bundled-features cannot
// import that package, which itself depends on bundled-features.
export type RenderSignatureHtmlToPdf = (html: string, options?: PdfOptions) => Promise<Uint8Array>;

export type SignatureLinkDelivery = {
  readonly signerId: string;
  readonly requestId: string;
  readonly name: string;
  readonly email: string;
  /** Signing link with the token in the fragment. */
  readonly url: string;
  /** Who issued the link, e.g. to pick the mailbox it is sent from. */
  readonly issuedBy: SessionUser;
};

// The token never leaves the server in a handler result: whoever calls issue-link would otherwise
// sign in the signer's place. The app sends the link to the signer's own address.
// Runs inside issue-link's transaction with its full context, so the app can dispatch its own mail write.
// The url must not land in an event, thread or record that other users or the assistant read.
export type DeliverSignatureLink = (
  ctx: HandlerContext,
  delivery: SignatureLinkDelivery,
) => Promise<void>;

export type SignatureOptions = {
  /** keepFor: how long requests and signers are kept, counted from creation (hard delete). unfinishedKeepFor: signers of declined, expired, failed or cancelled requests are anonymized this long after the request's last change. Both in data-retention keepFor syntax. */
  readonly retention: SignatureRetention;
  /** Renders the signature page (HTML) to a PDF. An outage leaves the request at `all-signed` and the sweep job retries. */
  readonly renderHtmlToPdf: RenderSignatureHtmlToPdf;
  /** HMAC secret of the signing links. Without it every link is rejected. */
  readonly linkSecret: string;
  /** Sends a freshly issued link to the signer, e.g. by mail. Runs inside the issue-link transaction, before it commits: enqueue through `ctx.dispatch` so the send commits or rolls back with the new link; a throw fails issue-link and leaves no link sent. */
  readonly deliverLink: DeliverSignatureLink;
  /** URL of the app's signature page; the token is appended as `#<token>`. */
  readonly signaturePageUrl: string;
  /** Access rule of the signed-in handlers, queries, screens and nav. Default `{ roles: ["TenantAdmin", "TenantMember"] }`; set it when the app hands out other roles. The link handlers stay anonymous. */
  readonly access?: AccessRule;
  /** Entity names a request may belong to (`hostType`). A user sees and works on a request only while its host row is readable to them; the names must be registered entities without their own `parentRef`. */
  readonly hostEntities: readonly [string, ...string[]];
};

export const LINK_RATE_LIMIT: RateLimitDeclaration = {
  per: "ip+handler",
  limit: 30,
  windowSeconds: 60,
};
