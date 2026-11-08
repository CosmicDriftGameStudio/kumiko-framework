// DOM-free signing page for static sites: fetch, canvas and Pointer Events only, no React. The link
// a signer receives carries the token in the URL fragment (`#token=`), which browsers never send to a
// server or in a Referer.

import {
  dispatchWrite,
  type StaticRequestOptions,
  type StaticResult,
  staticFailure,
  staticSuccess,
  takeUrlToken,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-client";
import { SIGNATURE_INVALID_LINK_REASON, SignatureHandlers } from "./web/constants.ts";

export {
  hrefWithoutUrlToken,
  readUrlToken,
  STATIC_NETWORK_REASON,
  STATIC_RATE_LIMITED_REASON,
  type StaticFailure,
  type StaticRequestOptions,
  type StaticResult,
  type StaticSuccess,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-client";
export {
  bytesToBase64,
  createSignaturePad,
  type SignaturePad,
  type SignaturePadCanvas,
  type SignaturePadOptions,
} from "./web/pad.ts";
export { SIGNATURE_INVALID_LINK_REASON };

export type SignatureLinkView = {
  readonly title: string;
  readonly signerName: string;
  readonly role: string | null;
  /** Short-lived URL of the PDF; null when the storage provider cannot sign URLs. */
  readonly documentUrl: string | null;
};

/** Reads `#token=` from the current page and removes it from the address bar. Browser only. */
export function takeSignatureToken(): string {
  return takeUrlToken("fragment");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseLinkView(data: unknown): SignatureLinkView | null {
  if (!isRecord(data)) return null;
  const { title, signerName, role, documentUrl } = data;
  if (typeof title !== "string" || typeof signerName !== "string") return null;
  return {
    title,
    signerName,
    role: typeof role === "string" ? role : null,
    documentUrl: typeof documentUrl === "string" ? documentUrl : null,
  };
}

/** Counts a view but does not use up the link. A bad, used or expired link fails with `invalid_or_expired_link`. */
export async function openSignatureLink(
  token: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<SignatureLinkView>> {
  const result = await dispatchWrite(SignatureHandlers.openByLink, { token }, options);
  if (result.kind !== "success") return result;
  const view = parseLinkView(result.data);
  return view === null ? staticFailure("unknown") : staticSuccess(view);
}

/** `imagePngBase64` comes from `SignaturePad.toPngBase64()`. Uses up the link on success. */
export async function signByLink(
  token: string,
  imagePngBase64: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  const result = await dispatchWrite(
    SignatureHandlers.signByLink,
    { token, imagePngBase64 },
    options,
  );
  return result.kind === "success" ? staticSuccess(undefined) : result;
}

export async function declineByLink(
  token: string,
  reason?: string,
  options?: StaticRequestOptions,
): Promise<StaticResult<undefined>> {
  const result = await dispatchWrite(
    SignatureHandlers.declineByLink,
    { token, ...(reason !== undefined && reason !== "" && { reason }) },
    options,
  );
  return result.kind === "success" ? staticSuccess(undefined) : result;
}
