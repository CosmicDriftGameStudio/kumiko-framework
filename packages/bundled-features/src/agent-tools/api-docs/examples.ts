import { type ApiExampleFile, ApiExampleFileSchema } from "@cosmicdrift/kumiko-types/api-example";
import { compareIds } from "../labels.ts";

export { type ApiExampleFile, ApiExampleFileSchema };

export type NamedApiExample = { readonly fileName: string; readonly file: ApiExampleFile };

/** A recording belongs to the handler named by `request.body.type`; when several
 *  recordings name the same handler the first file name in code-point order wins,
 *  so the choice never depends on directory listing order. */
export function examplesByHandler(
  examples: readonly NamedApiExample[],
): ReadonlyMap<string, ApiExampleFile> {
  const byHandler = new Map<string, ApiExampleFile>();
  const sorted = [...examples].sort((a, b) => compareIds(a.fileName, b.fileName));
  for (const { file } of sorted) {
    const handlerQn = file.request.body.type;
    if (handlerQn !== undefined && !byHandler.has(handlerQn)) byHandler.set(handlerQn, file);
  }
  return byHandler;
}
