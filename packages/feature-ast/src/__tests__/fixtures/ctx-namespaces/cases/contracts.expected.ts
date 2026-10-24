import type { AppContext, HandlerContext, JobContext } from "@cosmicdrift/kumiko-types/handlers";
import { takesAppContext } from "@cosmicdrift/kumiko-types/handlers";

type Resolver = { resolve(name: string): string };

export function readsExtensions(ctx: HandlerContext, job: JobContext) {
  const viaCast = (ctx.services.extensions as { templateResolver?: Resolver }).templateResolver;
  const viaDoubleCast = (ctx.services.extensions as unknown as { provisioner?: Resolver }).provisioner;
  const viaJob = (job.services.extensions as { templateResolver?: Resolver }).templateResolver;
  return [viaCast, viaDoubleCast, viaJob];
}

export function leavesOthersAlone(value: { a: string }, ctx: HandlerContext) {
  return [(value as { b?: string }).b, (ctx as { db?: unknown }).db];
}

export function readsWiring(ctx: HandlerContext) {
  return (ctx as AppContext).clock;
}

export function readsRemovedMembers(ctx: HandlerContext, job: JobContext) {
  return [ctx.systemUser, ctx.triggeredBy, ctx._tenantId, job.systemUser];
}

export function passesContexts(ctx: HandlerContext, job: JobContext) {
  takesAppContext(ctx);
  takesAppContext(job);
  takesAppContext({ clock: () => 1 });
}

type RedisReader = { readonly redis?: { get(key: string): Promise<string | null> } };
type Mailer = { readonly redis?: { get(key: string): Promise<string | null> }; readonly mailTo?: string };
type Plain = { readonly label?: string };

export function takesRedisReader(reader: RedisReader, name: string) {
  return [reader, name];
}

export function takesMailer(mailer: Mailer & { readonly signal?: AbortSignal }) {
  return mailer;
}

export function takesPlain(plain: Plain) {
  return plain;
}

export function passesToStructural(ctx: HandlerContext, job: JobContext) {
  takesRedisReader(ctx, "key");
  takesMailer(job);
  takesPlain(ctx);
  takesPlain(job);
}

// A cast that drops a real context member is not an extraContext read.
export function narrowedStubCast(ctx: Pick<HandlerContext, "db">) {
  delete (ctx as { user?: unknown }).user;
}
