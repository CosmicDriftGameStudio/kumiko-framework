// Optional handler-definition fields copied onto the registered handler only when set, so an absent
// field stays absent instead of becoming an explicit undefined.
import type { KumikoEventTypeMap } from "@cosmicdrift/kumiko-types/event-type-map";
import type {
  AgentHandlerHints,
  BeforeTransactionPhase,
  BeforeTransactionWhenNested,
} from "@cosmicdrift/kumiko-types/handlers";
import type { ZodType } from "zod";
import type { WriteHandlerDefinition } from "./define-handler.ts";

export function agentSlots(source: {
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
}): { description?: string; agent?: AgentHandlerHints } {
  return {
    ...(source.description !== undefined && { description: source.description }),
    ...(source.agent && { agent: source.agent }),
  };
}

export function transactionPhaseSlots<
  TSchema extends ZodType,
  TPrepared,
  TWhenNested extends BeforeTransactionWhenNested | undefined,
>(
  def: Pick<
    WriteHandlerDefinition<string, TSchema, unknown, KumikoEventTypeMap, TPrepared, TWhenNested>,
    "reserveBeforeTransaction" | "beforeTransaction" | "beforeTransactionWhenNested" | "transaction"
  >,
) {
  return {
    ...(def.reserveBeforeTransaction && {
      reserveBeforeTransaction: def.reserveBeforeTransaction,
    }),
    ...(def.beforeTransaction && {
      beforeTransaction: def.beforeTransaction as BeforeTransactionPhase, // @cast-boundary engine-bridge
    }),
    ...(def.beforeTransactionWhenNested && {
      beforeTransactionWhenNested: def.beforeTransactionWhenNested,
    }),
    ...(def.transaction && { transaction: def.transaction }),
  };
}
