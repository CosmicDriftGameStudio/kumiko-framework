import type { TranslationEntry, TranslationKeys } from "@cosmicdrift/kumiko-types/config";
import { toSnakeCase } from "../utils/case.ts";
import { UnprocessableError } from "./classes.ts";
import { type WriteFailure, writeFailure } from "./write-error-info.ts";

type FailureDetails = Readonly<Record<string, unknown>> & { readonly reason?: never };

export type FailureReasons<TName extends string> = {
  /** The `details.reason` slug a client compares against: `alreadyPaid` → `already_paid`. */
  reasonOf(name: TName): string;
  /** `<feature>.errors.<name>` → texts; register with `r.translations({ keys })` and ship to the client bundle. */
  readonly translationKeys: TranslationKeys;
  fail(
    name: TName,
    details?: FailureDetails,
    i18nParams?: Readonly<Record<string, unknown>>,
  ): WriteFailure;
};

// One table per feature keeps the reason slug, its i18n key and its texts from drifting apart.
export function defineFailureReasons<
  const TTable extends Readonly<Record<string, TranslationEntry>>,
>(featureName: string, table: TTable): FailureReasons<keyof TTable & string> {
  const i18nKeyOf = (name: string): string => `${featureName}.errors.${name}`;
  return {
    reasonOf: (name) => toSnakeCase(name),
    translationKeys: Object.fromEntries(
      Object.entries(table).map(([name, texts]) => [i18nKeyOf(name), texts]),
    ),
    fail: (name, details, i18nParams) =>
      writeFailure(
        new UnprocessableError(toSnakeCase(name), {
          i18nKey: i18nKeyOf(name),
          ...(details && { details }),
          ...(i18nParams && { i18nParams }),
        }),
      ),
  };
}
