import { AsyncLocalStorage } from "node:async_hooks";
import type { ReservationRelease } from "@cosmicdrift/kumiko-types/handlers";
import { hasAccess } from "../engine/access.js";
import type { SessionUser } from "../engine/types/index.js";
import { toWriteErrorInfo, type WriteErrorInfo } from "../errors/index.js";
import { createFallbackLogger } from "../logging/utils.js";
import type { BatchCommand, DispatchContext } from "./dispatch-shared.js";
import {
  buildHandlerContext,
  checkFeatureEnabled,
  isMemberResolutionPrincipal,
} from "./dispatch-shared.js";
import { wrapToKumiko } from "./dispatcher-utils.js";
import type { WriteOrigin } from "./write-origin.js";
import { effectiveWriteOrigin, rootWriteOrigin } from "./write-origin.js";

// One-shot permission per top-level command: the handler that reserved before the transaction
// consumes it on entry. A capped handler reached any other way (nested ctx.write, writeAs, a
// second execution of the same type) finds it spent and is rejected instead of running unreserved.
const reservedForCommand = new AsyncLocalStorage<Set<string>>();

export function runAsCommand<T>(reservedType: string | undefined, fn: () => Promise<T>) {
  return reservedForCommand.run(new Set(reservedType === undefined ? [] : [reservedType]), fn);
}

export function consumeReservation(type: string): boolean {
  return reservedForCommand.getStore()?.delete(type) === true;
}

export type PreTransactionReservations =
  | {
      readonly isSuccess: true;
      readonly reservedIndexes: ReadonlySet<number>;
      releaseAll(): Promise<void>;
    }
  | { readonly isSuccess: false; readonly error: WriteErrorInfo; readonly failedIndex: number };

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

// Same phase as the access/schema gates but before any transaction: a caller who would be denied
// or sends an invalid payload never reserves anything.
export async function reserveBeforeTransaction(
  ctx: DispatchContext,
  commands: readonly BatchCommand[],
  user: SessionUser,
  inheritedOrigin: WriteOrigin | undefined,
): Promise<PreTransactionReservations> {
  const releases: ReservationRelease[] = [];
  const reservedIndexes = new Set<number>();

  if (isMemberResolutionPrincipal(user))
    return { isSuccess: true, reservedIndexes, releaseAll: async () => {} };

  for (const [index, command] of commands.entries()) {
    try {
      const handler = ctx.registry.getWriteHandler(command.type);
      if (!handler?.reserveBeforeTransaction) continue;
      if (!hasAccess(user, handler.access)) continue;
      if (await checkFeatureEnabled(ctx, command.type, user.tenantId)) continue;
      const parsed = handler.schema.safeParse(command.payload);
      if (!parsed.success) continue;

      const origin = effectiveWriteOrigin(
        rootWriteOrigin(ctx.registry, command.type, user),
        inheritedOrigin,
      );
      const handlerContext = await buildHandlerContext(ctx, command.type, user, origin);
      const release = await handler.reserveBeforeTransaction(
        { type: command.type, payload: parsed.data, user },
        handlerContext,
      );
      if (release) releases.push(release);
      reservedIndexes.add(index);
    } catch (error) {
      await releaseAll(ctx, releases);
      return { isSuccess: false, error: toWriteErrorInfo(wrapToKumiko(error)), failedIndex: index };
    }
  }

  return { isSuccess: true, reservedIndexes, releaseAll: () => releaseAll(ctx, releases) };
}
