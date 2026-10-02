import { isAnonymousSessionUser } from "../engine/system-user.js";
import type { SessionUser } from "../engine/types/index.js";
import { AccessDeniedError, type KumikoError, UnauthenticatedError } from "../errors/index.js";

// Anonymous callers get 401 so a client whose session lapsed (browser dropped
// the expired auth cookie) can tell "sign in again" apart from "signed in but
// not allowed", which stays 403.
export function handlerAccessError(user: Pick<SessionUser, "roles">, type: string): KumikoError {
  if (isAnonymousSessionUser(user)) {
    return new UnauthenticatedError({
      message: `${type} requires a signed-in user`,
      details: { handler: type },
    });
  }
  return new AccessDeniedError({
    message: `access denied for ${type}`,
    details: { handler: type },
  });
}
