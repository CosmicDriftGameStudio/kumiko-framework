import { VersionConflictError as EventStoreVersionConflict } from "../event-store/errors";
import { InternalError, VersionConflictError } from "./classes";
import { isKumikoError, type KumikoError } from "./kumiko-error";

export function toKumikoError(e: unknown): KumikoError {
  if (isKumikoError(e)) return e;
  // A custom write racing another writer on the same stream (ctx.appendEvent,
  // stream.append) is a 409 the client can retry, not an internal error.
  // currentVersion -1 is the executor's "not looked up" sentinel.
  if (e instanceof EventStoreVersionConflict) {
    return new VersionConflictError(
      { entityId: e.aggregateId, expectedVersion: e.expectedVersion, currentVersion: -1 },
      { cause: e },
    );
  }
  if (e instanceof Error) return new InternalError({ cause: e });
  return new InternalError({ message: String(e) });
}
