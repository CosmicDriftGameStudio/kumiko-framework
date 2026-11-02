import { useMemo } from "react";
import { allOfSchemas, buildFormSchema } from "../app/form-schema.ts";
import type { FormValues } from "../headless/index.ts";
import type { RenderEditProps } from "./render-edit-types.ts";
import { isCreateModeEntityId } from "./use-render-edit-state.ts";

// The field-derived required checks always run; a caller `schema` only adds rules.
// For payloadMode "changes" a field still equal to its loaded value is exempt,
// matching what the server presence-checks.
export function useEffectiveFormSchema<TValues extends FormValues, TCtx>(
  props: RenderEditProps<TValues, TCtx>,
): RenderEditProps<TValues, TCtx>["schema"] {
  const { entity, screen, initial, entityId, payloadMode, schema } = props;
  const isCreateMode = isCreateModeEntityId(entityId);
  const unchangedFrom = !isCreateMode && payloadMode === "changes" ? initial : undefined;
  return useMemo(() => {
    const fieldSchema = buildFormSchema(
      entity,
      screen,
      isCreateMode ? "create" : "update",
      unchangedFrom,
    );
    return schema === undefined ? fieldSchema : allOfSchemas(schema, fieldSchema);
  }, [entity, screen, isCreateMode, unchangedFrom, schema]);
}
