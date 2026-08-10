import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { formDraftEntity } from "./entity";

export const { executor: formDraftExecutor, table: formDraftTable } = createEntityExecutor(
  "form-draft",
  formDraftEntity,
);
