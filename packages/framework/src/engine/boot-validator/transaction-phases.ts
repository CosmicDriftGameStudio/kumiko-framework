import type { FeatureDefinition } from "../types/index.ts";

function perCommandConflict(
  handler: FeatureDefinition["writeHandlers"][string],
): string | undefined {
  if (handler.transaction !== "perCommand") return undefined;
  if (handler.beforeTransaction) return "beforeTransaction";
  if (handler.reserveBeforeTransaction) return "reserveBeforeTransaction";
  return undefined;
}

export function validatePerCommandTransaction(
  featureName: string,
  handlerName: string,
  handler: FeatureDefinition["writeHandlers"][string],
): void {
  const conflicting = perCommandConflict(handler);
  if (conflicting !== undefined) {
    throw new Error(
      `write handler "${featureName}:write:${handlerName}" declares transaction: "perCommand" together with ${conflicting} — ` +
        "a perCommand handler holds no transaction, so move the phase into the commands it issues via ctx.dispatch.write.",
    );
  }
}

export function validateBeforeTransactionWhenNested(
  featureName: string,
  handlerName: string,
  handler: FeatureDefinition["writeHandlers"][string],
): void {
  // skip: handler does not opt into running nested without the phase
  if (handler.beforeTransactionWhenNested === undefined) return;
  const where = `write handler "${featureName}:write:${handlerName}" declares beforeTransactionWhenNested`;
  if (!handler.beforeTransaction) {
    throw new Error(`${where} without beforeTransaction — there is no phase to skip.`);
  }
  if (handler.reserveBeforeTransaction) {
    throw new Error(
      `${where} together with reserveBeforeTransaction — a nested run cannot skip the reservation, it would run unreserved.`,
    );
  }
}
