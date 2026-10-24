import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";

export async function plain(ctx: HandlerContext): Promise<void> {
  const { events: { append: appendEvent, load: loadAggregate }, db, } = ctx;
  await appendEvent("a", { db });
  await loadAggregate("x");
}

export async function renamed({ db, dispatch: { write: send, writeAs }, }: HandlerContext): Promise<void> {
  await send("a", { db });
  await writeAs("b", {});
}

export function withDefault(ctx: HandlerContext): void {
  const { log = undefined } = ctx;
  void log;
}

export function withRest(ctx: HandlerContext): void {
  const { appendEvent, ...rest } = ctx;
  void appendEvent;
  void rest;
}

export function withOutside(ctx: HandlerContext): void {
  const { db, dbOutsideTransaction } = ctx;
  void db;
  void dbOutsideTransaction;
}

export function alreadyNested(ctx: HandlerContext): void {
  const { db, registry } = ctx;
  void db;
  void registry;
}
