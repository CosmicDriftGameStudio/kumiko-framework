// Exhaustiveness-check helper for switch statements over union types.
// Dropping a new member into the union triggers a compile-time error in
// the call site unless a matching case is added — keeps switches honest
// through future enum growth.
//
//   switch (status) {
//     case "open": return ...;
//     case "closed": return ...;
//     default: assertUnreachable(status, "status");
//   }
//
// The `never` parameter makes TS flag any code path that still has a
// live value (e.g. a new union case was added and the switch missed it).
// Runtime also throws so a production surprise surfaces loudly instead
// of silently falling through.
export function assertUnreachable(value: never, kind: string): never {
  throw new Error(`[Kumiko] unhandled ${kind}: ${String(value)}`);
}
