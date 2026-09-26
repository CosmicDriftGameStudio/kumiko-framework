import { formalLocaleTag } from "@cosmicdrift/kumiko-framework/ui-types";
import { type GermanAddress, germanBundleFor, localeDeFormalOverrides } from "./formal";
import { localeDeBundle } from "./strings";

export type { GermanAddress };
export { localeDeBundle };

const GERMAN = "de" as const;
const GERMAN_FORMAL = formalLocaleTag(GERMAN);

// `address` sets the default wording under "de"; the formal overrides are
// always shipped under "de-x-formal" too, so a surface wrapped in
// FormalityProvider("formal") says "Sie" even when the app default is "du".
export function localeDeClient(options?: { readonly address?: GermanAddress }): {
  readonly name: "locale-de";
  readonly translations: {
    readonly [GERMAN]: Readonly<Record<string, string>>;
    readonly [GERMAN_FORMAL]: Readonly<Record<string, string>>;
  };
} {
  return {
    name: "locale-de",
    translations: {
      [GERMAN]: germanBundleFor(options?.address ?? "informal"),
      [GERMAN_FORMAL]: localeDeFormalOverrides,
    },
  };
}
