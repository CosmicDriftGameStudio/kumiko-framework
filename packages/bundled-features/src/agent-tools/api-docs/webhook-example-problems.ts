import { compareIds } from "../labels.ts";
import type { NamedWebhookExample } from "./examples.ts";
import type { ApiDocsEvent } from "./model.ts";
import type { ApiDocsProblem } from "./problems.ts";

/** Recordings that never reach the events page: for an event no scope lists, or recorded
 *  against another contract version than the current one. */
export function webhookExampleProblems(
  examples: readonly NamedWebhookExample[],
  events: readonly ApiDocsEvent[],
): readonly ApiDocsProblem[] {
  const eventByQn = new Map(events.map((event) => [event.qn, event]));
  const reported = new Set<string>();
  return [...examples]
    .sort((a, b) => compareIds(a.fileName, b.fileName))
    .flatMap(({ fileName, file }): ApiDocsProblem[] => {
      const event = eventByQn.get(file.event);
      if (event === undefined) return [{ kind: "unusedWebhookExample", fileName }];
      if (event.example !== undefined || reported.has(event.qn)) return [];
      reported.add(event.qn);
      return [
        {
          kind: "webhookExampleVersionMismatch",
          qn: event.qn,
          fileVersion: file.version,
          contractVersion: event.version,
        },
      ];
    });
}
