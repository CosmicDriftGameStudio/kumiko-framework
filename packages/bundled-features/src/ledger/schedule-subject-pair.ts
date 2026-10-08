import type { PreSaveHookFn } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError } from "@cosmicdrift/kumiko-framework/errors";

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

// subjectId is only unique within its subjectType, so a schedule with one of
// the two would be found by a lone-subjectId filter among other object types.
// The effective pair is checked (changes over the stored row) because an
// update may touch only one of the two fields.
export const requireScheduleSubjectPair: PreSaveHookFn = async (changes, ctx) => {
  const effective = (key: "subjectType" | "subjectId"): unknown =>
    key in changes ? changes[key] : ctx.previous[key];
  const hasType = isSet(effective("subjectType"));
  const hasId = isSet(effective("subjectId"));
  if (hasType === hasId) return changes;
  throw new ValidationError({
    fields: [
      {
        path: hasType ? "subjectId" : "subjectType",
        code: "required",
        i18nKey: "errors.validation.required",
      },
    ],
  });
};
