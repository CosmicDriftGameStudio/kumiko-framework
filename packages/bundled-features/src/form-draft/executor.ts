import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { formDraftEntity } from "./entity.js";

export const { executor: formDraftExecutor, table: formDraftTable } = createEntityExecutor(
  "form-draft",
  formDraftEntity,
);
