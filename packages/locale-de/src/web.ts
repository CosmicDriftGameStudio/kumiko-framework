import { localeDeBundle } from "./strings";

export { localeDeBundle };

export function localeDeClient(): {
  readonly translations: { readonly de: Readonly<Record<string, string>> };
} {
  return { translations: { de: localeDeBundle } };
}
