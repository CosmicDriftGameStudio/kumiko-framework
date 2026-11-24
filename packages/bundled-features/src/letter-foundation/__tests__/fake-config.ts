import type { ConfigAccessor } from "@cosmicdrift/kumiko-types/config";

/** A config accessor over fixed values keyed by qualified name; unset keys read as undefined. */
export function fakeConfigAccessor(
  values: Readonly<Record<string, string | number | boolean>>,
): ConfigAccessor {
  const read = async (keyOrHandle: string | { readonly name: string }) =>
    values[typeof keyOrHandle === "string" ? keyOrHandle : keyOrHandle.name];
  // Overloaded accessor type: the fake answers the same values for both call forms.
  return read as ConfigAccessor;
}
