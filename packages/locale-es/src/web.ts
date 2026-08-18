import { localeEsBundle } from "./strings";

export { localeEsBundle };

export function localeEsClient(): {
  readonly translations: { readonly es: Readonly<Record<string, string>> };
} {
  return { translations: { es: localeEsBundle } };
}
