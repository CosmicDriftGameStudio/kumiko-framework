import { AsyncLocalStorage } from "node:async_hooks";
import type { ReservationHandle, ReservationRelease } from "@cosmicdrift/kumiko-types/handlers";
import type { SessionUser } from "../engine/types/index.js";
import { toWriteErrorInfo, type WriteErrorInfo } from "../errors/index.js";
import { createFallbackLogger } from "../logging/utils.js";
import type { BatchCommand, DispatchContext } from "./dispatch-shared.js";
import { buildHandlerContext, isMemberResolutionPrincipal } from "./dispatch-shared.js";
import { wrapToKumiko } from "./dispatcher-utils.js";
import { runPreHandlerGates } from "./pre-handler-gates.js";
import type { WriteOrigin } from "./write-origin.js";
import { effectiveWriteOrigin, rootWriteOrigin } from "./write-origin.js";

type ReservationConfirm = ReservationHandle["confirmInTransaction"];

// What a command's pre-transaction reservation leaves for the handler run: the confirm, if the
// reservation settles inside the transaction.
export type ConsumedReservation = { readonly confirmInTransaction: ReservationConfirm | undefined };

// One-shot permission per top-level command: the handler that reserved before the transaction
// consumes it on entry. A capped handler reached any other way (nested ctx.write, writeAs, a
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
      log.error("releasing a pre-transaction reservation failed", { error });
    }
  }
}

// Same gates as the in-transaction run, but before any transaction: a caller who is rate limited,
// denied or sends an invalid payload never reserves anything, so a rejected request cannot consume
// capacity or trigger the reservation's side effects.
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
      if (!handler?.reserveBeforeTransaction) continue;

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
      const handlerContext = await buildHandlerContext(ctx, command.type, user, origin);
      const handle = toReservationHandle(
        await handler.reserveBeforeTransaction(
          { type: command.type, payload: gates.payload, user },
          handlerContext,
        ),
      );
      if (handle) releases.push(handle.release);
      reservedCommands.set(index, { confirmInTransaction: handle?.confirmInTransaction });
    } catch (error) {
      await releaseAll(ctx, releases);
      return { isSuccess: false, error: toWriteErrorInfo(wrapToKumiko(error)), failedIndex: index };
    }
  }

  return { isSuccess: true, reservedCommands, releaseAll: () => releaseAll(ctx, releases) };
}
