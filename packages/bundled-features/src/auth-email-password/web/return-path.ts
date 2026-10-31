// Shared by the server (mail link) and the web pages (landing page), so it is plain string logic:
// no DOM, no window, no `new URL` (React Native's URL getters throw).

import { readPathParam } from "./read-path-param.ts";

export const RETURN_TO_QUERY_PARAM = "returnTo";
export const MAX_RETURN_PATH_LENGTH = 2048;

const DOT_SEGMENTS = new Set([".", "..", ".%2e", "%2e.", "%2e%2e", "%2e"]);

function hasForbiddenCharacter(candidate: string): boolean {
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
    if (code === 0x5c) return true;
  }
  return false;
}

// A dot segment is resolved by URL normalization, so "/.//evil" would become "//evil".
function hasDotSegment(candidate: string): boolean {
  const pathEnd = candidate.search(/[?#]/);
  const path = pathEnd === -1 ? candidate : candidate.slice(0, pathEnd);
  return path.split("/").some((segment) => DOT_SEGMENTS.has(segment.toLowerCase()));
}

export function isSafeReturnPath(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  if (candidate.length < 1 || candidate.length > MAX_RETURN_PATH_LENGTH) return false;
  if (!candidate.startsWith("/") || candidate[1] === "/") return false;
  return !hasForbiddenCharacter(candidate) && !hasDotSegment(candidate);
}

export function readReturnToFromSearch(search: string): string | null {
  return readPathParam(search, RETURN_TO_QUERY_PARAM, isSafeReturnPath);
}
