import {
  type ApiExampleFile,
  ApiExampleFileSchema,
  type WebhookExampleFile,
  WebhookExampleFileSchema,
} from "@cosmicdrift/kumiko-types/api-example";
import { compareIds } from "../labels.ts";

export {
  type ApiExampleFile,
  ApiExampleFileSchema,
  type WebhookExampleFile,
  WebhookExampleFileSchema,
};

export type NamedWebhookExample = { readonly fileName: string; readonly file: WebhookExampleFile };

/** Same tie-break as `examplesByHandler`: the first file name in code-point order wins. */
export function webhookExamplesByEvent(
  examples: readonly NamedWebhookExample[],
): ReadonlyMap<string, WebhookExampleFile> {
  const byEvent = new Map<string, WebhookExampleFile>();
  const sorted = [...examples].sort((a, b) => compareIds(a.fileName, b.fileName));
  for (const { file } of sorted) if (!byEvent.has(file.event)) byEvent.set(file.event, file);
  return byEvent;
}

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
