// setTimeout overflows (fires immediately) above 2^31-1 ms; a token that
// outlives it just gets its stream recycled early, the client reconnects.
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

// JWT expiry raises no access-invalidation event, so a long-lived stream must end itself
// when the token it was opened with expires. Callers clear the returned timer on release.
export function scheduleTokenExpiry(
  tokenExpiresAtSec: number | undefined,
  onExpired: () => void,
): ReturnType<typeof setTimeout> | undefined {
  if (tokenExpiresAtSec === undefined) return undefined;
  return setTimeout(
    onExpired,
    Math.min(MAX_TIMER_DELAY_MS, Math.max(0, tokenExpiresAtSec * 1000 - Date.now())),
  );
}
