import { SYSTEM_ROLE, SYSTEM_USER_ID } from "../engine/system-user.js";
import type { SessionUser } from "../engine/types/index.js";
import type { LockGuardOption } from "./event-store-executor.js";

// Art. 17 erasure runs as the framework operator, not as a row owner; a
// per-role ownership map can never cover it, and a silent deny means the
// erasure never happened.
export function isFrameworkSystemUser(user: SessionUser): boolean {
  return user.id === SYSTEM_USER_ID && user.roles.includes(SYSTEM_ROLE);
}

// Framework system writes that name a writePurpose (retention, erasure) are exempt:
// statutory deletion must reach locked rows. The options are server-code only; no
// request field is ever copied into them.
export function isLockGuardBypassed(
  user: SessionUser,
  options: LockGuardOption | undefined,
): boolean {
  return (
    options?.unsafeSkipLockGuard === true ||
    (options?.writePurpose !== undefined && isFrameworkSystemUser(user))
  );
}
