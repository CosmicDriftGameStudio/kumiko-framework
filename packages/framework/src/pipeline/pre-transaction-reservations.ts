import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ReservationHandle,
  ReservationRelease,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-types/handlers";
import type { SessionUser } from "../engine/types/index.ts";

import type { WriteErrorInfo } from "../errors/index.ts";
import { toWriteErrorInfo } from "../errors/write-error-info.ts";

import { createFallbackLogger } from "../logging/utils.ts";
import type { BatchCommand, DispatchContext } from "./dispatch-shared.ts";
import { buildHandlerContext, isMemberResolutionPrincipal } from "./dispatch-shared.ts";
import { wrapToKumiko } from "./dispatcher-utils.ts";
import { runPreHandlerGates } from "./pre-handler-gates.ts";
import type { WriteOrigin } from "./write-origin.ts";
import { effectiveWriteOrigin, rootWriteOrigin } from "./write-origin.ts";

type ReservationConfirm = ReservationHandle["confirmInTransaction"];

// What a command's pre-transaction phases leave for the handler run: the confirm, if the
// reservation settles inside the transaction, and the beforeTransaction phase's data.
export type ConsumedReservation = {
  readonly confirmInTransaction: ReservationConfirm | undefined;
  readonly prepared: unknown;
  // The payload the phases saw: parsing twice would hand the handler a different value wherever the schema generates one.
  readonly parsedPayload: unknown;
};

export function hasPreTransactionPhase(handler: WriteHandlerDef): boolean {
  return handler.reserveBeforeTransaction !== undefined || handler.beforeTransaction !== undefined;
}

// One-shot permission per top-level command: the handler that reserved before the transaction
// consumes it on entry. A capped handler reached any other way (nested ctx.dispatch.write, writeAs, a
// second execution of the same type) finds it spent and is rejected instead of running unreserved.
const reservedForCommand = new AsyncLocalStorage<Map<string, ConsumedReservation>>();

export function runAsCommand<T>(
  reserved: { readonly type: string; readonly reservation: ConsumedReservation } | undefined,
  fn: () => Promise<T>,
) {
  const store = new Map<string, ConsumedReservation>();
  if (reserved) store.set(reserved.type, reserved.reservation);
  return reservedForCommand.run(store, fn);
}

export function consumeReservation(type: string): ConsumedReservation | undefined {
  const store = reservedForCommand.getStore();
  const reservation = store?.get(type);
  store?.delete(type);
  return reservation;
}

export type PreTransactionReservations =
  | {
      readonly isSuccess: true;
      readonly reservedCommands: ReadonlyMap<number, ConsumedReservation>;
      releaseAll(): Promise<void>;
    }
  | { readonly isSuccess: false; readonly error: WriteErrorInfo; readonly failedIndex: number };

function toReservationHandle(
  taken: ReservationRelease | ReservationHandle | undefined,
): ReservationHandle | undefined {
  if (taken === undefined) return undefined;
  if (typeof taken === "function") {
    return { release: taken, confirmInTransaction: async () => {} };
  }
  return taken;
}

async function releaseAll(ctx: DispatchContext, releases: readonly ReservationRelease[]) {
  const log = createFallbackLogger("dispatcher", ctx.appContext.log);
  for (const release of [...releases].reverse()) {
    try {
      await release();
    } catch (error) {
      log.error("releasing a pre-transaction phase failed", { error });
    }
  }
}

// Same gates as the in-transaction run, but before any transaction: a caller who is rate limited,
// denied or sends an invalid payload never reserves or prepares anything, so a rejected request
// cannot consume capacity or trigger external calls.
export async function reserveBeforeTransaction(
  ctx: DispatchContext,
  commands: readonly BatchCommand[],
  user: SessionUser,
  inheritedOrigin: WriteOrigin | undefined,
): Promise<PreTransactionReservations> {
  const releases: ReservationRelease[] = [];
  const reservedCommands = new Map<number, ConsumedReservation>();

  if (isMemberResolutionPrincipal(user))
    return { isSuccess: true, reservedCommands, releaseAll: async () => {} };

  for (const [index, command] of commands.entries()) {
    try {
      const handler = ctx.registry.getWriteHandler(command.type);
      if (!handler || !hasPreTransactionPhase(handler)) continue;

      const gates = await runPreHandlerGates(
        ctx,
        handler,
        command.type,
        command.payload,
        user,
        "charge",
      );
      if (!gates.isSuccess) {
        await releaseAll(ctx, releases);
        return { isSuccess: false, error: gates.error, failedIndex: index };
      }

      const origin = effectiveWriteOrigin(
        rootWriteOrigin(ctx.registry, command.type, user),
        inheritedOrigin,
      );
      const event = { type: command.type, payload: gates.payload, user };

      let confirmInTransaction: ReservationConfirm | undefined;
      if (handler.reserveBeforeTransaction) {
        const reservationContext = await buildHandlerContext(ctx, command.type, user, origin, {
          phase: "reservation",
        });
        const handle = toReservationHandle(
          await handler.reserveBeforeTransaction(event, reservationContext),
        );
        if (handle) releases.push(handle.release);
        confirmInTransaction = handle?.confirmInTransaction;
      }

      let prepared: unknown;
      if (handler.beforeTransaction) {
        const phaseContext = await buildHandlerContext(ctx, command.type, user, origin, {
          phase: "beforeTransaction",
        });
        const phase = await handler.beforeTransaction(event, phaseContext);
        if (!phase.isSuccess) {
          await releaseAll(ctx, releases);
          return { isSuccess: false, error: phase.error, failedIndex: index };
        }
        if (phase.release) releases.push(phase.release);
        prepared = phase.data;
      }

      reservedCommands.set(index, {
        confirmInTransaction,
        prepared,
        parsedPayload: gates.payload,
      });
    } catch (error) {
      await releaseAll(ctx, releases);
      return { isSuccess: false, error: toWriteErrorInfo(wrapToKumiko(error)), failedIndex: index };
    }
  }

  return { isSuccess: true, reservedCommands, releaseAll: () => releaseAll(ctx, releases) };
}
