// Pure form helpers shared by auth screens. Extracted so unit tests can
// pin password / rate-limit / redirect rules without mounting React.

export type PasswordPairIssue = "too_short" | "mismatch";

/** Client-side password + confirm check before calling signup/reset APIs. */
export function passwordPairIssue(
  password: string,
  confirmPassword: string,
  minLength = 8,
): PasswordPairIssue | null {
  if (password.length < minLength) return "too_short";
  if (password !== confirmPassword) return "mismatch";
  return null;
}

/** Maps server `retryAfterSeconds` to whole minutes for i18n interpolation. */
export function retryAfterMinutes(retryAfterSeconds?: number): number | undefined {
  if (retryAfterSeconds === undefined) return undefined;
  return Math.ceil(retryAfterSeconds / 60);
}

/** Resolves post-login redirect: string template or function of tenantKey. */
export function resolveLoggedInHref(
  href: string | ((args: { readonly tenantKey: string }) => string),
  tenantKey: string,
): string {
  return typeof href === "function" ? href({ tenantKey }) : href;
}
