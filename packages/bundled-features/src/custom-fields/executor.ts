import { createEntityExecutor } from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionEntity } from "./entity";

// Single field-definition executor shared by the four define/delete handlers.
// createEntityExecutor is side-effect-free; instantiating it once keeps the
// table+executor pair in one place instead of rebuilding it per handler module.
export const { executor: fieldDefinitionExecutor } = createEntityExecutor(
  "field-definition",
  fieldDefinitionEntity,
);
