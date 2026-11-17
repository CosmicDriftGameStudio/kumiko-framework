import {
  createEntityExecutor,
  FIELD_CHANGE_REQUEST_ENTITY_NAME,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFieldChangeRequestEntity, fieldChangeRequestEntity } from "./entity.ts";

// ungated: system paths and tests only; handlers use createFieldChangeRequestExecutor
export const { executor: fieldChangeRequestExecutor, table: fieldChangeRequestTable } =
  createEntityExecutor(fieldChangeRequestEntity);

export function createFieldChangeRequestExecutor(
  parents: readonly string[],
): typeof fieldChangeRequestExecutor {
  return createEntityExecutor(
    createFieldChangeRequestEntity(parents),
  ).executor;
}
