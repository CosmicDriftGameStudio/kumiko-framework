import { localeItBundle } from "./strings";

export { localeItBundle };

export function localeItClient(): {
  readonly name: "locale-it";
  readonly translations: { readonly it: Readonly<Record<string, string>> };
} {
  return { name: "locale-it", translations: { it: localeItBundle } };
}
