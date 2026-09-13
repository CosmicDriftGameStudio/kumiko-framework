import { type GermanAddress, germanBundleFor } from "./formal";
import { localeDeBundle } from "./strings";

export type { GermanAddress };
export { localeDeBundle };

export function localeDeClient(options?: { readonly address?: GermanAddress }): {
  readonly name: "locale-de";
  readonly translations: { readonly de: Readonly<Record<string, string>> };
} {
  return {
    name: "locale-de",
    translations: { de: germanBundleFor(options?.address ?? "informal") },
  };
}
