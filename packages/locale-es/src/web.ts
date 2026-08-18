import { localeEsBundle } from "./strings";

export { localeEsBundle };

export function localeEsClient(): {
  readonly name: "locale-es";
  readonly translations: { readonly es: Readonly<Record<string, string>> };
} {
  return { name: "locale-es", translations: { es: localeEsBundle } };
}
