import { localeFrBundle } from "./strings";

export { localeFrBundle };

export function localeFrClient(): {
  readonly name: "locale-fr";
  readonly translations: { readonly fr: Readonly<Record<string, string>> };
} {
  return { name: "locale-fr", translations: { fr: localeFrBundle } };
}
