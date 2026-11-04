// A device clock can be minutes off, and "As of 10:42" or "5 minutes ago" must agree with the
// server's timestamps. The offset comes from the `x-kumiko-now` header (the app clock, which a
// fixed test or screenshot clock overrides) and otherwise from the HTTP `Date` header; without
// either (cross-origin answers hide both) the device clock stays.
const APP_NOW_HEADER = "x-kumiko-now";
let offsetMs = 0;

/** Remembers how far the server clock is ahead of the device clock; ignores a missing or invalid header. */
export function noteServerClock(headers: Pick<Headers, "get">): void {
  const serverMs = Date.parse(headers.get(APP_NOW_HEADER) ?? headers.get("date") ?? "");
  if (Number.isFinite(serverMs)) offsetMs = serverMs - Date.now();
}

/** The server's current time, as best known from the last answer. */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

/** Test seam: forget the offset. */
export function resetServerClock(): void {
  offsetMs = 0;
}
