import type { AuthMfaFeatureOptions } from "../auth-mfa/index.ts";

export const testAuthMfaOptions: AuthMfaFeatureOptions = {
  setupTokenSecret: "test-setup-token-secret-do-not-use-in-prod",
  issuer: "Kumiko Test",
  challengeTokenSecret: "test-mfa-challenge-secret-at-least-32-bytes!!",
};
