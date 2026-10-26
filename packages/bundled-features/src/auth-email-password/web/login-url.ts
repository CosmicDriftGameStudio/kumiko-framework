// Pure (no DOM, no `new URL`): the redirect vocabulary shared by the SPA gate and the static login.

import { RETURN_TO_QUERY_PARAM } from "./return-path.ts";

export const NEXT_QUERY_PARAM = "next";

/** Builds the login page URL. `returnPath` is the current path + query + hash;
 *  append it as `next` yourself (use `NEXT_QUERY_PARAM`) if the login page should return there. */
export type LoginUrlBuilder = (locale: string, returnPath: string) => string;

// Adds returnTo to an href of a sibling auth page; a missing value leaves the href untouched.
export function appendReturnTo(href: string, returnTo: string | null): string {
  if (returnTo === null) return href;
  const hashAt = href.indexOf("#");
  const base = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${RETURN_TO_QUERY_PARAM}=${encodeURIComponent(returnTo)}${hash}`;
}
