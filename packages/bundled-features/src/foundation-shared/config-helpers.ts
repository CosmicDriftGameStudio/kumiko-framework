// Shared config-read helpers used by the per-tenant Foundation factories
// (ai-foundation, mail-foundation, file-foundation). Each foundation reads
// its config-keys + secret out of `ctx`, narrows undefined → throw, and
// dispatches to a provider. The narrowing helpers live here as a single
// source so all three foundations report errors the same way and a fix
// to one error-message format reaches all callers.
//
// **Why a shared module instead of duplicate copies:**
//   First two foundations (ai + mail) hand-rolled identical helpers,
//   the third (file) made it three times. That's the threshold where
//   premature-abstraction-warnings flip to DRY-warnings — three nearly-
//   identical 25-LOC helper-pairs across three files would diverge in
//   error-text under maintenance, exactly the bug-class extraction
//   prevents.
//
// **What this module is NOT:**
//   - Not a feature — no `defineFeature`, no boot-time registration.
//   - Not a barrel for everything — only the helpers actually shared
//     across foundations live here. Per-foundation transport/provider-
//     factories stay in their own package.

/**
 * Narrow `value | undefined` → `value` with a clear message that names
 * which config key resolved to nothing. Use for keys whose `undefined`
 * means a registry misconfiguration (no value + no default).
 *
 * Foundation-Pattern: this is the wrap-helper around `await ctx.config(
 * featureFoundationFeature.exports.configKeys.someKey)` — the call-site
 * stays a single line per key.
 *
 * **`featureName` is the qualified-name prefix in the error** (e.g.
 * `"ai-foundation"`, `"mail-foundation"`) — included so that an exception
 * surfaced from a multi-foundation app pinpoints the failing foundation.
 */
export function requireDefined<T>(value: T | undefined, featureName: string, label: string): T {
  if (value === undefined) {
    throw new Error(
      `${featureName}: '${label}' config key resolved to undefined — registry misconfigured (no value + no default)`,
    );
  }
  return value;
}

/**
 * Narrow `string | undefined` → non-empty `string`. Tighter than
 * `requireDefined` for the case where the registry HAS a default (often
 * `""`) but the foundation requires the tenant to have set a real value
 * before the factory can build a working transport / provider.
 *
 * Typical use: SMTP host, S3 bucket, model id — values without which the
 * downstream SDK would 400 with a cryptic message. The clearer "tenant
 * must configure X via tenant-admin UI" lands at the call-site instead.
 *
 * Whitespace is trimmed: a whitespace-only value counts as empty, and the
 * returned string has surrounding whitespace removed — so a stray " host "
 * never reaches the SDK as-is.
 */
export function requireNonEmpty(
  value: string | undefined,
  featureName: string,
  label: string,
  uiHint = "Set via tenant-admin UI or seed-handler.",
): string {
  const trimmed = requireDefined(value, featureName, label).trim();
  if (trimmed.length === 0) {
    throw new Error(
      `${featureName}: '${label}' is empty — tenant must configure it before use. ${uiHint}`,
    );
  }
  return trimmed;
}
