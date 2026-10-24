import type { AppendEventFn, UnsafeAppendEventFn } from "@cosmicdrift/kumiko-types/handlers";
// The per-event-type signature is only enforced at the call site; at runtime the payload is validated against the registered schema.
export function asTypedAppendEventFn(append: UnsafeAppendEventFn): AppendEventFn {
  return append as AppendEventFn; // @cast-boundary engine-bridge
}
