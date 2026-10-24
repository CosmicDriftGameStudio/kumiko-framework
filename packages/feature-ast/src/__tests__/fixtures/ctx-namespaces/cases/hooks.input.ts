import type { AppContext } from "@cosmicdrift/kumiko-types/handlers";
import { onPostSave, onPreSave, takesAppContext } from "@cosmicdrift/kumiko-types/handlers";

onPostSave(async (_result, context: AppContext) => {
  context.log?.info("saved");
  context.scheduleAfterCommit?.(async () => {});
  takesAppContext(context);
});

onPreSave(async (changes, context: AppContext & { readonly isNew: boolean }) => {
  context.tracer?.span(context.isNew ? "new" : "existing");
  return changes;
});

export function plainHelper(context: AppContext) {
  return context.log;
}
