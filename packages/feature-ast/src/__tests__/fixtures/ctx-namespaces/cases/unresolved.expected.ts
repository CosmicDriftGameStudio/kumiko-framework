export function untyped(ctx, other) {
  ctx.appendEvent("a", {});
  other.appendEvent("b", {});
  return ctx.db;
}
