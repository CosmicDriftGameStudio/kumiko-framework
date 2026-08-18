import { localeDeBundle } from "./strings";

export { localeDeBundle };

export function localeDeClient(): {
  readonly name: "locale-de";
  readonly translations: { readonly de: Readonly<Record<string, string>> };
} {
  return { name: "locale-de", translations: { de: localeDeBundle } };
}
