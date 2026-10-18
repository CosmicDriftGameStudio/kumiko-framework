import { InternalError } from "./classes.ts";
import { isKumikoError, type KumikoError } from "./kumiko-error.ts";

export function toKumikoError(e: unknown): KumikoError {
  if (isKumikoError(e)) return e;
  if (e instanceof Error) return new InternalError({ cause: e });
  return new InternalError({ message: String(e) });
}
