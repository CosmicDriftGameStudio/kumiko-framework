import { AsyncLocalStorage } from "node:async_hooks";
import type { ReservationRelease } from "@cosmicdrift/kumiko-types/handlers";
import { hasAccess } from "../engine/access.js";
import type { SessionUser } from "../engine/types/index.js";
import { isKumikoError, toWriteErrorInfo, type WriteErrorInfo } from "../errors/index.js";
import { createFallbackLogger } from "../logging/utils.js";
import type { BatchCommand, DispatchContext } from "./dispatch-shared.js";
import { buildHandlerContext, checkFeatureEnabled } from "./dispatch-shared.js";
import type { WriteOrigin } from "./write-origin.js";
import { effectiveWriteOrigin, rootWriteOrigin } from "./write-origin.js";

// Handler types reserved by the top-level batch this async chain belongs to. A capped handler
// reached any other way (nested ctx.write) cannot reserve before a transaction that is already open.
const reservedHandlerTypes = new AsyncLocalStorage<ReadonlySet<string>>();

export function runWithReservedHandlerTypes<T>(types: ReadonlySet<string>, fn: () => Promise<T>) {
  return reservedHandlerTypes.run(types, fn);
}

export function isReservedBeforeTransaction(type: string): boolean {
  return reservedHandlerTypes.getStore()?.has(type) === true;
}

export type PreTransactionReservations =
  | {
      readonly isSuccess: true;
      readonly types: ReadonlySet<string>;
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
  const types = new Set<string>();

  for (const [index, command] of commands.entries()) {
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
    try {
      const handlerContext = await buildHandlerContext(ctx, command.type, user, origin);
      const release = await handler.reserveBeforeTransaction(
        { type: command.type, payload: parsed.data, user },
        handlerContext,
      );
      if (release) releases.push(release);
      types.add(command.type);
    } catch (error) {
      await releaseAll(ctx, releases);
      if (isKumikoError(error)) {
        return { isSuccess: false, error: toWriteErrorInfo(error), failedIndex: index };
      }
      throw error;
    }
  }

  return { isSuccess: true, types, releaseAll: () => releaseAll(ctx, releases) };
}
