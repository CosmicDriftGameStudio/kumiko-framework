// @runtime client
import type { useTranslation } from "@cosmicdrift/kumiko-renderer";

type Translate = ReturnType<typeof useTranslation>;

/** `t(key)` returns the key itself when the key is missing from every
 *  bundle — the convention every cell that translates an open-ended,
 *  app-extensible value (a status, a role name) relies on to fall back to
 *  the raw value instead of showing a dot-form key to the user. */
export function translateOrRaw(t: Translate, key: string, raw: string): string {
  const translated = t(key);
  return translated === key ? raw : translated;
}
