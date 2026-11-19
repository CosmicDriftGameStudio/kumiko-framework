import { createEntity } from "@cosmicdrift/kumiko-framework/engine";

export const taskEntity = createEntity({
  name: "task",
  fields: { title: { type: "text", allowPlaintext: "fixture value" } },
});
