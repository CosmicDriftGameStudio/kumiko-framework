import type { EnvelopeCipher } from "../../secrets/envelope-cipher.ts";

export type ValidateBootOptions = {
  /** Warn when an access role is used by exactly one handler/config-key/
   *  field across the whole boot scan — often a typo, but also the normal
   *  shape of a legitimate fine-grained role (one role scoped to one admin
   *  endpoint on purpose). Opt-in (default false): a default-on
   *  prod warning that nobody can silence per-role isn't worth the noise
   *  it generates on every boot. */
  readonly warnOnUniqueAccessRoles?: boolean;
  /** QNs the app's sidebar allowlist admits. When set, every declared nav
   *  whose screen isn't reachable from any allowlisted nav entry gets a
   *  boot-time warning — that screen would otherwise be silently
   *  unreachable via the sidebar. When omitted and the app has
   *  workspaces, the allowlist is derived from `r.workspace({ nav })` and
   *  `r.nav({ workspaces })` assignments instead. */
  readonly navAllowlist?: ReadonlySet<string>;
  /** Nav QNs deliberately left out of the sidebar allowlist because their
   *  screen is reachable another way (e.g. as a sub-page of a generated
   *  settings hub). Suppresses the navAllowlist warning for these QNs. */
  readonly navAllowlistExempt?: ReadonlySet<string>;
  /** Env the encrypted-field master-key probe reads. Defaults to
   *  `process.env`; runners pass their resolved env so a ciphertext-only
   *  key (already decrypted at boot) is visible to the probe. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The cipher the runner injects after validation (built from the app's
   *  `masterKey` or the env keyring). Satisfies the availability check for
   *  `encrypted: true` fields without an env KEK. */
  readonly entityFieldCipher?: EnvelopeCipher;
  /** Locales every translation key must carry across all mounted features
   *  (locale packages count). Without it a key can ship in one language and
   *  silently fall back at runtime for users of the others. */
  readonly requiredLocales?: readonly string[];
  /** Require translations for the values that entityList columns and entityEdit
   *  fields display: select/multiSelect option labels and the column headers
   *  and select options of embedded lists. Without them the UI shows raw
   *  option values and sub-field names. Opt-in (default false). */
  readonly requireFieldValueTranslations?: boolean;
};
