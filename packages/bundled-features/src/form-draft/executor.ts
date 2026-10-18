import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { formDraftEntity } from "./entity.ts";

export const { executor: formDraftExecutor, table: formDraftTable } = createEntityExecutor(
  "form-draft",
  formDraftEntity,
);
