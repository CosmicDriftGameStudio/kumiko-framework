import type { AppContext, HandlerContext } from "@cosmicdrift/kumiko-types/handlers";
import { onPostSave, onPreSave, takesAppContext } from "@cosmicdrift/kumiko-types/handlers";

onPostSave(async (_result, context: HandlerContext) => {
  context.obs.log?.info("saved");
  context.lifecycle.afterCommit?.(async () => {});
  takesAppContext(context);
});

onPreSave(async (changes, context: HandlerContext & { readonly isNew: boolean }) => {
  context.obs.tracer?.span(context.isNew ? "new" : "existing");
  return changes;
});

export function plainHelper(context: AppContext) {
  return context.log;
}
