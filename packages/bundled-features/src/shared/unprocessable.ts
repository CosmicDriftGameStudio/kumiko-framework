import {
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";

type UnprocessableDetails = NonNullable<
  ConstructorParameters<typeof UnprocessableError>[1]
>["details"];

export function unprocessable(
  reason: string,
  i18nKey: string,
  details?: UnprocessableDetails,
): WriteFailure {
  return writeFailure(
    new UnprocessableError(reason, details === undefined ? { i18nKey } : { i18nKey, details }),
  );
}
