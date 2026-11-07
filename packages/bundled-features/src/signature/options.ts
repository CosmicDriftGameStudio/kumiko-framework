import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
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
};

// The token never leaves the server in a handler result: whoever calls issue-link would otherwise
// sign in the signer's place. The app sends the link to the signer's own address.
export type DeliverSignatureLink = (
  ctx: Pick<HandlerContext, "db" | "services">,
  delivery: SignatureLinkDelivery,
) => Promise<void>;

export type SignatureOptions = {
  /** How long requests and signers are kept, data-retention keepFor syntax, counted from creation. */
  readonly retention: SignatureRetention;
  /** Renders the signature page (HTML) to a PDF. An outage leaves the request at `all-signed` and the sweep job retries. */
  readonly renderHtmlToPdf: RenderSignatureHtmlToPdf;
  /** HMAC secret of the signing links. Without it every link is rejected. */
  readonly linkSecret: string;
  /** Sends a freshly issued link to the signer, e.g. by mail. A throw fails issue-link and leaves no link sent. */
  readonly deliverLink: DeliverSignatureLink;
  /** URL of the app's signature page; the token is appended as `#<token>`. */
  readonly signaturePageUrl: string;
};

export const LINK_RATE_LIMIT: RateLimitDeclaration = {
  per: "ip+handler",
  limit: 30,
  windowSeconds: 60,
};
